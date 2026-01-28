#!/usr/bin/env node
/**
 * Column Verification Script
 * 
 * Checks if all columns used in backend code exist in the migration script.
 * 
 * Usage: node db-utils/verify-columns.js
 */

const fs = require('fs');
const path = require('path');

// Columns used in backend code (extracted from grep analysis)
const columnsUsed = {
  scheduled_posts: [
    'id', 'user_id', 'social_account_id', 'campaign_id', 'template_id',
    'platform', 'content_type', 'title', 'content', 'hashtags', 'mentions',
    'location', 'alt_text', 'media_urls', 'media_types', 'media_sizes', 'media_formats',
    'video_duration', 'video_resolution', 'video_aspect_ratio', 'video_bitrate', 'video_fps', 'video_thumbnail_url',
    'image_width', 'image_height', 'image_aspect_ratio',
    'audio_duration', 'audio_title', 'audio_url', 'audio_artist',
    'scheduled_for', 'status', 'priority', 'error_code', 'error_message',
    'platform_post_id', 'post_url', 'published_at',
    'metadata', 'created_at', 'updated_at'
  ],
  queue_jobs: [
    'id', 'scheduled_post_id', 'job_type', 'status', 'priority',
    'scheduled_for', 'attempts', 'max_attempts', 'error_message', 'error_code',
    'result_data', 'next_retry_at', 'processed_at', 'completed_at',
    'created_at', 'updated_at'
  ],
  queue_job_logs: [
    'id', 'job_id', 'log_level', 'message', 'metadata', 'created_at'
  ],
  social_accounts: [
    'id', 'user_id', 'platform', 'platform_user_id', 'account_name', 'username',
    'profile_picture_url', 'follower_count', 'following_count',
    'access_token', 'refresh_token', 'token_expires_at', 'is_active',
    'permissions', 'last_sync_at', 'created_at', 'updated_at'
  ],
  content_analytics: [
    'id', 'scheduled_post_id', 'user_id', 'platform', 'analytics_date',
    'views', 'likes', 'shares', 'comments', 'saves', 'clicks',
    'retweets', 'quotes', 'reactions', 'platform_metrics',
    'engagement_rate', 'reach', 'impressions', 'created_at', 'updated_at'
  ],
  platform_performance: [
    'id', 'user_id', 'platform', 'date',
    'total_posts', 'total_views', 'total_likes', 'total_shares', 'total_comments',
    'total_engagement', 'avg_engagement_rate', 'total_reach', 'total_impressions',
    'content_type_breakdown', 'best_performing_posts',
    'created_at', 'updated_at'
  ],
  hashtag_performance: [
    'id', 'user_id', 'hashtag', 'platform', 'date',
    'usage_count', 'total_engagement', 'avg_engagement_rate',
    'created_at', 'updated_at'
  ],
  content_templates: [
    'id', 'user_id', 'campaign_id', 'name', 'description', 'content',
    'platform', 'content_type', 'hashtags', 'media_requirements', 'variables',
    'tags', 'is_public', 'usage_count', 'created_at', 'updated_at'
  ],
  weekly_content_refinements: [
    'id', 'campaign_id', 'week_number', 'theme', 'focus_area', 'focus_areas',
    'marketing_channels', 'existing_content', 'content_notes', 'week_start_date',
    'assigned_to_user_id', 'assigned_by_user_id', 'status', 'completed_at', 'notes',
    'content_plan', 'created_at', 'updated_at'
  ],
  daily_content_plans: [
    'id', 'campaign_id', 'weekly_refinement_id', 'scheduled_post_id',
    'date', 'day_of_week', 'content_type', 'platform', 'theme',
    'content_description', 'hashtags', 'media_requirements', 'status',
    'created_at', 'updated_at'
  ],
  notifications: [
    'id', 'user_id', 'type', 'title', 'message', 'metadata', 'is_read', 'created_at'
  ],
  activity_feed: [
    'id', 'user_id', 'action_type', 'entity_type', 'entity_id', 'campaign_id',
    'metadata', 'created_at'
  ],
  media_files: [
    'id', 'user_id', 'campaign_id', 'file_name', 'file_path', 'file_url',
    'file_size', 'mime_type', 'media_type', 'width', 'height', 'duration',
    'storage_provider', 'storage_bucket', 'metadata', 'created_at', 'updated_at'
  ],
  scheduled_post_media: [
    'id', 'scheduled_post_id', 'media_file_id', 'display_order', 'created_at'
  ]
};

// Read migration script
const migrationPath = path.join(__dirname, 'complete-integration-migration.sql');
const migrationScript = fs.readFileSync(migrationPath, 'utf8');

console.log('🔍 Verifying database columns...\n');

let allPassed = true;
let totalChecks = 0;
let passedChecks = 0;
let missingColumns = [];

// Check each table
for (const [tableName, columns] of Object.entries(columnsUsed)) {
  console.log(`📋 Checking table: ${tableName}`);
  
  for (const column of columns) {
    totalChecks++;
    
    // Check if column exists in migration script
    // Look for: column_name TYPE or column_name, or ADD COLUMN column_name
    const patterns = [
      new RegExp(`\\b${column}\\s+(?:VARCHAR|TEXT|INTEGER|BIGINT|BOOLEAN|UUID|DATE|TIMESTAMP|NUMERIC|JSONB)`, 'i'),
      new RegExp(`ADD COLUMN ${column}`, 'i'),
      new RegExp(`\\b${column}\\s*,`, 'i'),
      new RegExp(`\\b${column}\\s*\\[`, 'i'), // For arrays
    ];
    
    const found = patterns.some(pattern => pattern.test(migrationScript));
    
    if (found) {
      passedChecks++;
      process.stdout.write('.');
    } else {
      allPassed = false;
      missingColumns.push({ table: tableName, column });
      console.log(`\n❌ MISSING: ${tableName}.${column}`);
    }
  }
  
  console.log(`\n✅ ${tableName}: ${columns.length} columns checked`);
}

console.log('\n' + '='.repeat(60));
console.log(`📊 Verification Summary`);
console.log('='.repeat(60));
console.log(`Total Columns Checked: ${totalChecks}`);
console.log(`✅ Passed: ${passedChecks}`);
console.log(`❌ Missing: ${missingColumns.length}`);

if (missingColumns.length > 0) {
  console.log('\n⚠️  Missing Columns:');
  missingColumns.forEach(({ table, column }) => {
    console.log(`   - ${table}.${column}`);
  });
  console.log('\n💡 These columns need to be added to the migration script.');
} else {
  console.log('\n✅ All required columns are present in the migration script!');
}

process.exit(allPassed ? 0 : 1);

