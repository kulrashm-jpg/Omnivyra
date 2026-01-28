-- STEP 8: INSERT INITIAL DATA
-- Run this after step 7 is complete

-- Insert platform configurations
INSERT INTO platform_configurations (platform, posting_limits, content_limits, media_limits) VALUES
('linkedin', 
 '{"max_posts_per_day": 5, "max_posts_per_hour": 1, "min_interval_minutes": 60}',
 '{"max_characters": 3000, "max_hashtags": 5, "max_mentions": 10}',
 '{"max_files": 9, "max_file_size_mb": 5120, "allowed_formats": ["jpg", "png", "mp4", "mov", "pdf"], "max_video_duration": 600}'
),
('twitter',
 '{"max_posts_per_day": 50, "max_posts_per_hour": 5, "min_interval_minutes": 12}',
 '{"max_characters": 280, "max_hashtags": 2, "max_mentions": 10}',
 '{"max_files": 4, "max_file_size_mb": 15, "allowed_formats": ["jpg", "png", "gif", "mp4", "mov"], "max_video_duration": 140}'
),
('instagram',
 '{"max_posts_per_day": 25, "max_posts_per_hour": 3, "min_interval_minutes": 20}',
 '{"max_characters": 2200, "max_hashtags": 30, "max_mentions": 20}',
 '{"max_files": 10, "max_file_size_mb": 100, "allowed_formats": ["jpg", "png", "mp4", "mov"], "max_video_duration": 60}'
),
('youtube',
 '{"max_posts_per_day": 10, "max_posts_per_hour": 1, "min_interval_minutes": 60}',
 '{"max_characters": 5000, "max_hashtags": 15, "max_mentions": 0}',
 '{"max_files": 1, "max_file_size_mb": 262144, "allowed_formats": ["mp4", "mov", "avi", "wmv"], "max_video_duration": 43200}'
),
('facebook',
 '{"max_posts_per_day": 25, "max_posts_per_hour": 3, "min_interval_minutes": 20}',
 '{"max_characters": 63206, "max_hashtags": 30, "max_mentions": 50}',
 '{"max_files": 12, "max_file_size_mb": 1024, "allowed_formats": ["jpg", "png", "gif", "mp4", "mov"], "max_video_duration": 1200}'
);

-- Insert system settings
INSERT INTO system_settings (key, value, description) VALUES
('queue_processing_interval', '10000', 'Queue processing interval in milliseconds'),
('max_retry_attempts', '3', 'Maximum number of retry attempts for failed posts'),
('analytics_retention_days', '365', 'Number of days to retain analytics data'),
('notification_retention_days', '30', 'Number of days to retain notifications'),
('ai_analysis_enabled', 'true', 'Whether AI content analysis is enabled'),
('optimal_timing_enabled', 'true', 'Whether optimal posting time suggestions are enabled');

-- Success message
SELECT 'Initial data inserted successfully! Database setup complete!' as message;
