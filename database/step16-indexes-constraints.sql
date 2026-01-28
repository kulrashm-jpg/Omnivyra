-- STEP 16: ADD INDEXES AND CONSTRAINTS FOR NEW TABLES
-- Run this after step 15 is complete

-- ==============================================
-- INDEXES FOR NEW TABLES
-- ==============================================

-- User Authentication & Security Indexes
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX idx_user_sessions_active ON user_sessions(is_active);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_active ON api_keys(is_active);
CREATE INDEX idx_api_keys_expires ON api_keys(expires_at);

CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);

CREATE INDEX idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
CREATE INDEX idx_email_verification_tokens_token ON email_verification_tokens(token);
CREATE INDEX idx_email_verification_tokens_expires ON email_verification_tokens(expires_at);

CREATE INDEX idx_user_2fa_user_id ON user_2fa(user_id);
CREATE INDEX idx_user_2fa_enabled ON user_2fa(is_enabled);

CREATE INDEX idx_login_attempts_email ON login_attempts(email);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address);
CREATE INDEX idx_login_attempts_attempted ON login_attempts(attempted_at);
CREATE INDEX idx_login_attempts_success ON login_attempts(success);

CREATE INDEX idx_security_events_user_id ON security_events(user_id);
CREATE INDEX idx_security_events_type ON security_events(event_type);
CREATE INDEX idx_security_events_created ON security_events(created_at);
CREATE INDEX idx_security_events_severity ON security_events(severity);

-- Comment Management & Engagement Indexes
CREATE INDEX idx_post_comments_scheduled_post ON post_comments(scheduled_post_id);
CREATE INDEX idx_post_comments_platform ON post_comments(platform);
CREATE INDEX idx_post_comments_author ON post_comments(author_username);
CREATE INDEX idx_post_comments_created ON post_comments(created_at);
CREATE INDEX idx_post_comments_flagged ON post_comments(is_flagged);
CREATE INDEX idx_post_comments_sentiment ON post_comments(sentiment_score);

CREATE INDEX idx_comment_replies_comment ON comment_replies(comment_id);
CREATE INDEX idx_comment_replies_user ON comment_replies(user_id);
CREATE INDEX idx_comment_replies_status ON comment_replies(status);

CREATE INDEX idx_comment_likes_comment ON comment_likes(comment_id);
CREATE INDEX idx_comment_likes_user ON comment_likes(user_id);

CREATE INDEX idx_comment_flags_comment ON comment_flags(comment_id);
CREATE INDEX idx_comment_flags_user ON comment_flags(user_id);
CREATE INDEX idx_comment_flags_status ON comment_flags(status);

CREATE INDEX idx_direct_messages_user ON direct_messages(user_id);
CREATE INDEX idx_direct_messages_account ON direct_messages(social_account_id);
CREATE INDEX idx_direct_messages_platform ON direct_messages(platform);
CREATE INDEX idx_direct_messages_read ON direct_messages(is_read);
CREATE INDEX idx_direct_messages_created ON direct_messages(created_at);

CREATE INDEX idx_message_replies_message ON message_replies(message_id);
CREATE INDEX idx_message_replies_user ON message_replies(user_id);
CREATE INDEX idx_message_replies_status ON message_replies(status);

CREATE INDEX idx_engagement_rules_user ON engagement_rules(user_id);
CREATE INDEX idx_engagement_rules_platform ON engagement_rules(platform);
CREATE INDEX idx_engagement_rules_active ON engagement_rules(is_active);

-- Content Moderation Indexes
CREATE INDEX idx_content_moderation_post ON content_moderation(scheduled_post_id);
CREATE INDEX idx_content_moderation_status ON content_moderation(moderation_status);
CREATE INDEX idx_content_moderation_moderator ON content_moderation(moderated_by);
CREATE INDEX idx_content_moderation_created ON content_moderation(created_at);

CREATE INDEX idx_compliance_violations_post ON compliance_violations(scheduled_post_id);
CREATE INDEX idx_compliance_violations_platform ON compliance_violations(platform);
CREATE INDEX idx_compliance_violations_type ON compliance_violations(violation_type);
CREATE INDEX idx_compliance_violations_resolved ON compliance_violations(resolved_at);

CREATE INDEX idx_moderation_policies_user ON moderation_policies(user_id);
CREATE INDEX idx_moderation_policies_platform ON moderation_policies(platform);
CREATE INDEX idx_moderation_policies_active ON moderation_policies(is_active);

CREATE INDEX idx_content_flags_post ON content_flags(scheduled_post_id);
CREATE INDEX idx_content_flags_user ON content_flags(flagged_by);
CREATE INDEX idx_content_flags_status ON content_flags(status);

CREATE INDEX idx_brand_safety_scores_post ON brand_safety_scores(scheduled_post_id);
CREATE INDEX idx_brand_safety_scores_overall ON brand_safety_scores(overall_score);

CREATE INDEX idx_copyright_claims_post ON copyright_claims(scheduled_post_id);
CREATE INDEX idx_copyright_claims_platform ON copyright_claims(platform);
CREATE INDEX idx_copyright_claims_status ON copyright_claims(status);

CREATE INDEX idx_moderation_queue_post ON moderation_queue(scheduled_post_id);
CREATE INDEX idx_moderation_queue_assigned ON moderation_queue(assigned_to);
CREATE INDEX idx_moderation_queue_status ON moderation_queue(status);
CREATE INDEX idx_moderation_queue_priority ON moderation_queue(priority DESC);

CREATE INDEX idx_moderation_logs_post ON moderation_logs(scheduled_post_id);
CREATE INDEX idx_moderation_logs_action ON moderation_logs(action);
CREATE INDEX idx_moderation_logs_created ON moderation_logs(created_at);

-- Advanced Scheduling Indexes
CREATE INDEX idx_user_timezones_user ON user_timezones(user_id);
CREATE INDEX idx_user_timezones_primary ON user_timezones(is_primary);
CREATE INDEX idx_user_timezones_active ON user_timezones(is_active);

CREATE INDEX idx_scheduling_rules_user ON scheduling_rules(user_id);
CREATE INDEX idx_scheduling_rules_platform ON scheduling_rules(platform);
CREATE INDEX idx_scheduling_rules_active ON scheduling_rules(is_active);

CREATE INDEX idx_bulk_operations_user ON bulk_operations(user_id);
CREATE INDEX idx_bulk_operations_type ON bulk_operations(operation_type);
CREATE INDEX idx_bulk_operations_status ON bulk_operations(status);
CREATE INDEX idx_bulk_operations_created ON bulk_operations(created_at);

CREATE INDEX idx_bulk_operation_items_operation ON bulk_operation_items(bulk_operation_id);
CREATE INDEX idx_bulk_operation_items_post ON bulk_operation_items(scheduled_post_id);
CREATE INDEX idx_bulk_operation_items_status ON bulk_operation_items(status);

CREATE INDEX idx_post_templates_user ON post_templates(user_id);
CREATE INDEX idx_post_templates_platform ON post_templates(platform);
CREATE INDEX idx_post_templates_public ON post_templates(is_public);

CREATE INDEX idx_post_series_user ON post_series(user_id);
CREATE INDEX idx_post_series_platform ON post_series(platform);
CREATE INDEX idx_post_series_active ON post_series(is_active);

CREATE INDEX idx_post_series_items_series ON post_series_items(series_id);
CREATE INDEX idx_post_series_items_post ON post_series_items(scheduled_post_id);
CREATE INDEX idx_post_series_items_status ON post_series_items(status);

CREATE INDEX idx_content_calendar_user ON content_calendar(user_id);
CREATE INDEX idx_content_calendar_public ON content_calendar(is_public);

CREATE INDEX idx_calendar_events_calendar ON calendar_events(calendar_id);
CREATE INDEX idx_calendar_events_post ON calendar_events(scheduled_post_id);
CREATE INDEX idx_calendar_events_start ON calendar_events(start_time);

CREATE INDEX idx_scheduling_conflicts_user ON scheduling_conflicts(user_id);
CREATE INDEX idx_scheduling_conflicts_post ON scheduling_conflicts(scheduled_post_id);
CREATE INDEX idx_scheduling_conflicts_resolved ON scheduling_conflicts(is_resolved);

-- Advanced Analytics Indexes
CREATE INDEX idx_audience_insights_user ON audience_insights(user_id);
CREATE INDEX idx_audience_insights_platform ON audience_insights(platform);
CREATE INDEX idx_audience_insights_date ON audience_insights(date);

CREATE INDEX idx_custom_reports_user ON custom_reports(user_id);
CREATE INDEX idx_custom_reports_type ON custom_reports(report_type);
CREATE INDEX idx_custom_reports_active ON custom_reports(is_active);

CREATE INDEX idx_report_data_report ON report_data(report_id);
CREATE INDEX idx_report_data_generated ON report_data(generated_at);

CREATE INDEX idx_content_performance_insights_post ON content_performance_insights(scheduled_post_id);
CREATE INDEX idx_content_performance_insights_platform ON content_performance_insights(platform);
CREATE INDEX idx_content_performance_insights_date ON content_performance_insights(date);

CREATE INDEX idx_competitor_analysis_user ON competitor_analysis(user_id);
CREATE INDEX idx_competitor_analysis_platform ON competitor_analysis(platform);
CREATE INDEX idx_competitor_analysis_date ON competitor_analysis(analysis_date);

CREATE INDEX idx_roi_analysis_user ON roi_analysis(user_id);
CREATE INDEX idx_roi_analysis_campaign ON roi_analysis(campaign_id);
CREATE INDEX idx_roi_analysis_period ON roi_analysis(analysis_period_start, analysis_period_end);

CREATE INDEX idx_content_trends_platform ON content_trends(platform);
CREATE INDEX idx_content_trends_date ON content_trends(trend_date);
CREATE INDEX idx_content_trends_type ON content_trends(trend_type);

CREATE INDEX idx_ab_test_results_user ON ab_test_results(user_id);
CREATE INDEX idx_ab_test_results_platform ON ab_test_results(platform);
CREATE INDEX idx_ab_test_results_status ON ab_test_results(status);

-- Integration & Webhook Indexes
CREATE INDEX idx_webhooks_user ON webhooks(user_id);
CREATE INDEX idx_webhooks_platform ON webhooks(platform);
CREATE INDEX idx_webhooks_active ON webhooks(is_active);

CREATE INDEX idx_webhook_logs_webhook ON webhook_logs(webhook_id);
CREATE INDEX idx_webhook_logs_triggered ON webhook_logs(triggered_at);
CREATE INDEX idx_webhook_logs_success ON webhook_logs(success);

CREATE INDEX idx_third_party_integrations_user ON third_party_integrations(user_id);
CREATE INDEX idx_third_party_integrations_type ON third_party_integrations(integration_type);
CREATE INDEX idx_third_party_integrations_active ON third_party_integrations(is_active);

CREATE INDEX idx_integration_logs_integration ON integration_logs(integration_id);
CREATE INDEX idx_integration_logs_created ON integration_logs(created_at);

CREATE INDEX idx_api_rate_limits_user ON api_rate_limits(user_id);
CREATE INDEX idx_api_rate_limits_platform ON api_rate_limits(platform);
CREATE INDEX idx_api_rate_limits_reset ON api_rate_limits(reset_at);

CREATE INDEX idx_external_data_sources_user ON external_data_sources(user_id);
CREATE INDEX idx_external_data_sources_type ON external_data_sources(source_type);
CREATE INDEX idx_external_data_sources_sync ON external_data_sources(sync_enabled);

CREATE INDEX idx_external_data_sync_logs_source ON external_data_sync_logs(data_source_id);
CREATE INDEX idx_external_data_sync_logs_started ON external_data_sync_logs(started_at);

CREATE INDEX idx_notification_templates_user ON notification_templates(user_id);
CREATE INDEX idx_notification_templates_type ON notification_templates(template_type);
CREATE INDEX idx_notification_templates_active ON notification_templates(is_active);

CREATE INDEX idx_notification_subscriptions_user ON notification_subscriptions(user_id);
CREATE INDEX idx_notification_subscriptions_event ON notification_subscriptions(event_type);
CREATE INDEX idx_notification_subscriptions_active ON notification_subscriptions(is_active);

CREATE INDEX idx_notification_delivery_logs_subscription ON notification_delivery_logs(subscription_id);
CREATE INDEX idx_notification_delivery_logs_sent ON notification_delivery_logs(sent_at);
CREATE INDEX idx_notification_delivery_logs_status ON notification_delivery_logs(status);

-- ==============================================
-- ADDITIONAL CONSTRAINTS FOR NEW TABLES
-- ==============================================

-- User Authentication Constraints
ALTER TABLE user_sessions ADD CONSTRAINT chk_session_token_length CHECK (LENGTH(session_token) >= 32);
ALTER TABLE api_keys ADD CONSTRAINT chk_key_prefix_length CHECK (LENGTH(key_prefix) >= 8);
ALTER TABLE password_reset_tokens ADD CONSTRAINT chk_token_length CHECK (LENGTH(token) >= 32);
ALTER TABLE email_verification_tokens ADD CONSTRAINT chk_verification_token_length CHECK (LENGTH(token) >= 32);

-- Comment Management Constraints
ALTER TABLE post_comments ADD CONSTRAINT chk_sentiment_score CHECK (sentiment_score >= -1.0 AND sentiment_score <= 1.0);
ALTER TABLE comment_replies ADD CONSTRAINT chk_reply_status CHECK (status IN ('pending', 'sent', 'failed', 'deleted'));
ALTER TABLE comment_flags ADD CONSTRAINT chk_flag_type CHECK (flag_type IN ('spam', 'inappropriate', 'harassment', 'other'));
ALTER TABLE comment_flags ADD CONSTRAINT chk_flag_status CHECK (status IN ('pending', 'reviewed', 'dismissed', 'action_taken'));

-- Content Moderation Constraints
ALTER TABLE content_moderation ADD CONSTRAINT chk_moderation_status CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'flagged', 'needs_review'));
ALTER TABLE content_moderation ADD CONSTRAINT chk_moderation_score CHECK (moderation_score >= 0.0 AND moderation_score <= 1.0);
ALTER TABLE compliance_violations ADD CONSTRAINT chk_violation_severity CHECK (severity IN ('low', 'medium', 'high', 'critical'));
ALTER TABLE brand_safety_scores ADD CONSTRAINT chk_brand_safety_score CHECK (overall_score >= 0.0 AND overall_score <= 1.0);
ALTER TABLE moderation_queue ADD CONSTRAINT chk_queue_type CHECK (queue_type IN ('ai_review', 'human_review', 'compliance_check'));
ALTER TABLE moderation_queue ADD CONSTRAINT chk_queue_status CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

-- Advanced Scheduling Constraints
ALTER TABLE user_timezones ADD CONSTRAINT chk_timezone_format CHECK (timezone ~ '^[A-Za-z_/]+$');
ALTER TABLE scheduling_rules ADD CONSTRAINT chk_rule_type CHECK (rule_type IN ('time_restriction', 'content_filter', 'frequency_limit', 'audience_targeting'));
ALTER TABLE bulk_operations ADD CONSTRAINT chk_operation_type CHECK (operation_type IN ('bulk_schedule', 'bulk_delete', 'bulk_update', 'bulk_duplicate'));
ALTER TABLE bulk_operations ADD CONSTRAINT chk_operation_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));
ALTER TABLE bulk_operations ADD CONSTRAINT chk_progress_percentage CHECK (progress_percentage >= 0.0 AND progress_percentage <= 100.0);

-- Advanced Analytics Constraints
ALTER TABLE content_performance_insights ADD CONSTRAINT chk_sentiment_range CHECK (sentiment_score >= -1.0 AND sentiment_score <= 1.0);
ALTER TABLE content_performance_insights ADD CONSTRAINT chk_score_range CHECK (topic_relevance_score >= 0.0 AND topic_relevance_score <= 1.0);
ALTER TABLE ab_test_results ADD CONSTRAINT chk_ab_test_status CHECK (status IN ('running', 'completed', 'cancelled'));
ALTER TABLE ab_test_results ADD CONSTRAINT chk_confidence_level CHECK (confidence_level >= 0.0 AND confidence_level <= 1.0);

-- Integration Constraints
ALTER TABLE webhooks ADD CONSTRAINT chk_webhook_timeout CHECK (timeout_seconds > 0 AND timeout_seconds <= 300);
ALTER TABLE webhooks ADD CONSTRAINT chk_webhook_retries CHECK (max_retries >= 0 AND max_retries <= 10);
ALTER TABLE third_party_integrations ADD CONSTRAINT chk_integration_type CHECK (integration_type IN ('zapier', 'ifttt', 'slack', 'discord', 'google_analytics', 'custom'));
ALTER TABLE notification_templates ADD CONSTRAINT chk_template_type CHECK (template_type IN ('email', 'sms', 'push', 'webhook'));

-- ==============================================
-- ADDITIONAL TRIGGERS FOR NEW TABLES
-- ==============================================

-- Apply updated_at triggers to new tables
CREATE TRIGGER update_user_sessions_updated_at BEFORE UPDATE ON user_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_2fa_updated_at BEFORE UPDATE ON user_2fa FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_post_comments_updated_at BEFORE UPDATE ON post_comments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_comment_replies_updated_at BEFORE UPDATE ON comment_replies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_engagement_rules_updated_at BEFORE UPDATE ON engagement_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_content_moderation_updated_at BEFORE UPDATE ON content_moderation FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_compliance_violations_updated_at BEFORE UPDATE ON compliance_violations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_moderation_policies_updated_at BEFORE UPDATE ON moderation_policies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_timezones_updated_at BEFORE UPDATE ON user_timezones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_scheduling_rules_updated_at BEFORE UPDATE ON scheduling_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_post_templates_updated_at BEFORE UPDATE ON post_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_post_series_updated_at BEFORE UPDATE ON post_series FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_post_series_items_updated_at BEFORE UPDATE ON post_series_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_content_calendar_updated_at BEFORE UPDATE ON content_calendar FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_calendar_events_updated_at BEFORE UPDATE ON calendar_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_custom_reports_updated_at BEFORE UPDATE ON custom_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_third_party_integrations_updated_at BEFORE UPDATE ON third_party_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_external_data_sources_updated_at BEFORE UPDATE ON external_data_sources FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notification_templates_updated_at BEFORE UPDATE ON notification_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notification_subscriptions_updated_at BEFORE UPDATE ON notification_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Success message
SELECT 'Indexes and constraints for new tables created successfully! Database setup complete!' as message;
