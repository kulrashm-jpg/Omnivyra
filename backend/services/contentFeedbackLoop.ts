/**
 * CONTENT FEEDBACK LOOP SERVICE
 *
 * Tracks engagement outcomes from posted content and replies:
 * - IMMEDIATE: Record tone used + engagement type (instant)
 * - DELAYED: Collect metrics 24-48h later (reactions, replies, sentiment)
 * - LEARNING: Update effectiveness scores, feed back into generation
 *
 * Integration points:
 * - Called by processor after job completes
 * - Called by engagement system after reply posted
 * - Queues feedback tracking jobs for async processing
 */

import { getSharedRedisClient } from '../queue/bullmqClient';
import IORedis from 'ioredis';

interface ToneFeedback {
  company_id: string;
  platform: string;
  engagement_type?: string;
  tone: string;
  effectiveness: number; // 0-1
  confidence: number; // 0-1, higher = more data points
  timestamp: Date;
}

interface AngleFeedback {
  company_id: string;
  angle: 'analytical' | 'contrarian' | 'strategic';
  content_type: string;
  engagement_type?: string;
  effectiveness: number;
  confidence: number;
  timestamp: Date;
}

/**
 * Record immediate tone feedback (called right after response posted)
 * Fast path: just store in Redis
 */
export async function recordQuickToneFeedback(input: {
  company_id: string;
  platform: string;
  engagement_type?: string;
  tone: string;
  timestamp: Date;
}): Promise<void> {
  const redis = getSharedRedisClient();
  const key = `tone_feedback:${input.company_id}:${input.platform}:${input.engagement_type || 'general'}`;

  // Store as list for later aggregation (TTL 30 days)
  await redis.lpush(key, JSON.stringify({
    tone: input.tone,
    timestamp: input.timestamp.toISOString(),
  }));
  await redis.expire(key, 30 * 24 * 3600);
}

/**
 * Record detailed tone effectiveness (called after metrics collected)
 * Used by learning pipeline to update effectiveness scores
 */
export async function recordToneFeedback(feedback: ToneFeedback): Promise<void> {
  const redis = getSharedRedisClient();

  // Store effectiveness score (TTL 90 days for historical analysis)
  const scoreKey = `tone_effectiveness:${feedback.company_id}:${feedback.platform}:${feedback.tone}`;
  const record = {
    effectiveness: feedback.effectiveness,
    confidence: feedback.confidence,
    timestamp: feedback.timestamp.toISOString(),
  };

  await redis.lpush(scoreKey, JSON.stringify(record));
  await redis.expire(scoreKey, 90 * 24 * 3600);

  // Also update a summary hash for quick lookups
  const summaryKey = `tone_summary:${feedback.company_id}:${feedback.platform}`;
  const entries = await redis.lrange(scoreKey, 0, -1);

  if (entries.length > 0) {
    const scores = entries.map(e => {
      const parsed = JSON.parse(e);
      return parsed.effectiveness;
    });
    const avgEffectiveness = scores.reduce((a, b) => a + b, 0) / scores.length;

    await redis.hset(summaryKey, feedback.tone, JSON.stringify({
      effectiveness: avgEffectiveness,
      samples: scores.length,
      updated_at: new Date().toISOString(),
    }));
  }
}

/**
 * Record angle effectiveness feedback (called after metrics collected)
 */
export async function recordAngleFeedback(feedback: AngleFeedback): Promise<void> {
  const redis = getSharedRedisClient();

  // Store effectiveness score
  const scoreKey = `angle_effectiveness:${feedback.company_id}:${feedback.content_type}:${feedback.angle}`;
  const record = {
    effectiveness: feedback.effectiveness,
    confidence: feedback.confidence,
    engagement_type: feedback.engagement_type,
    timestamp: feedback.timestamp.toISOString(),
  };

  await redis.lpush(scoreKey, JSON.stringify(record));
  await redis.expire(scoreKey, 90 * 24 * 3600);

  // Update summary
  const summaryKey = `angle_summary:${feedback.company_id}:${feedback.content_type}`;
  const entries = await redis.lrange(scoreKey, 0, -1);

  if (entries.length > 0) {
    const scores = entries.map(e => JSON.parse(e).effectiveness);
    const avgEffectiveness = scores.reduce((a, b) => a + b, 0) / scores.length;

    await redis.hset(summaryKey, feedback.angle, JSON.stringify({
      effectiveness: avgEffectiveness,
      samples: scores.length,
      updated_at: new Date().toISOString(),
    }));
  }
}

/**
 * Get tone effectiveness for a company/platform
 * Used by angle selection to pick best tone
 */
export async function getToneEffectiveness(
  company_id: string,
  platform: string
): Promise<Record<string, { effectiveness: number; samples: number }>> {
  const redis = getSharedRedisClient();
  const summaryKey = `tone_summary:${company_id}:${platform}`;

  const data = await redis.hgetall(summaryKey);
  const result: Record<string, { effectiveness: number; samples: number }> = {};

  for (const [tone, json] of Object.entries(data)) {
    try {
      const parsed = JSON.parse(json);
      result[tone] = parsed;
    } catch {
      // Ignore parse errors
    }
  }

  return result;
}

/**
 * Get angle effectiveness for a company/content_type
 * Used by angle selection to pick best angle
 */
export async function getAngleEffectiveness(
  company_id: string,
  content_type: string
): Promise<Record<string, { effectiveness: number; samples: number }>> {
  const redis = getSharedRedisClient();
  const summaryKey = `angle_summary:${company_id}:${content_type}`;

  const data = await redis.hgetall(summaryKey);
  const result: Record<string, { effectiveness: number; samples: number }> = {};

  for (const [angle, json] of Object.entries(data)) {
    try {
      const parsed = JSON.parse(json);
      result[angle] = parsed;
    } catch {
      // Ignore parse errors
    }
  }

  return result;
}

/**
 * Get all tone feedback for a company (for training)
 * Returns raw feedback entries for analysis
 */
export async function getSampleToneFeedback(input: {
  company_id: string;
  days?: number;
  min_samples?: number;
}): Promise<Record<string, ToneFeedback[]>> {
  const redis = getSharedRedisClient();
  const days = input.days || 30;
  const minTime = Date.now() - (days * 24 * 3600 * 1000);

  // Get all tone feedback keys for this company
  const pattern = `tone_effectiveness:${input.company_id}:*`;
  const keys = await redis.keys(pattern);

  const result: Record<string, ToneFeedback[]> = {};

  for (const key of keys) {
    const entries = await redis.lrange(key, 0, -1);

    const feedbacks: ToneFeedback[] = [];
    for (const entry of entries) {
      try {
        const parsed = JSON.parse(entry);
        const timestamp = new Date(parsed.timestamp);

        if (timestamp.getTime() > minTime) {
          // Extract company, platform, tone from key
          const parts = key.split(':');
          feedbacks.push({
            company_id: input.company_id,
            platform: parts[2] || 'unknown',
            tone: parts[3] || 'unknown',
            effectiveness: parsed.effectiveness,
            confidence: parsed.confidence,
            timestamp,
          });
        }
      } catch {
        // Ignore parse errors
      }
    }

    const tone = key.split(':')[3];
    if (feedbacks.length >= (input.min_samples || 1)) {
      result[tone || 'unknown'] = feedbacks;
    }
  }

  return result;
}

/**
 * Clear old feedback data (retention cleanup)
 * Run periodically to keep Redis memory under control
 */
export async function cleanupOldFeedback(olderThanDays: number = 90): Promise<number> {
  const redis = getSharedRedisClient();
  const cutoffTime = Date.now() - (olderThanDays * 24 * 3600 * 1000);

  let deletedCount = 0;

  // Find all feedback keys
  const patterns = ['tone_effectiveness:*', 'angle_effectiveness:*'];

  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);

    for (const key of keys) {
      const entries = await redis.lrange(key, 0, -1);
      const toKeep = [];

      for (const entry of entries) {
        try {
          const parsed = JSON.parse(entry);
          const timestamp = new Date(parsed.timestamp);

          if (timestamp.getTime() > cutoffTime) {
            toKeep.push(entry);
          }
        } catch {
          toKeep.push(entry);
        }
      }

      if (toKeep.length === 0) {
        await redis.del(key);
        deletedCount++;
      } else if (toKeep.length < entries.length) {
        // Rewrite list with only kept entries
        await redis.del(key);
        if (toKeep.length > 0) {
          await redis.rpush(key, ...toKeep);
        }
        deletedCount++;
      }
    }
  }

  return deletedCount;
}

/**
 * Record creator content feedback
 * Tracks performance of video scripts, carousels, stories
 * - Theme effectiveness (educational vs entertainment vs inspirational)
 * - Angle effectiveness (analytical vs contrarian vs strategic)
 * - Platform performance (which platforms saw best engagement)
 */
export async function recordCreatorFeedback(input: {
  company_id: string;
  content_type: 'video_script' | 'carousel' | 'story';
  platforms: string[];
  theme_used: string;
  angle_used: 'analytical' | 'contrarian' | 'strategic';
  timestamp: Date;
}): Promise<void> {
  const redis = getSharedRedisClient();

  // Store creator content generation event
  const key = `creator_feedback:${input.company_id}:${input.content_type}`;
  const entry = JSON.stringify({
    platforms: input.platforms,
    theme: input.theme_used,
    angle: input.angle_used,
    timestamp: input.timestamp.toISOString(),
  });

  await redis.rpush(key, entry);
  await redis.expire(key, 2592000); // 30 days

  // Track theme effectiveness
  const themeKey = `creator_theme:${input.company_id}:${input.theme_used}`;
  await redis.incr(themeKey);
  await redis.expire(themeKey, 2592000);

  // Track angle effectiveness
  const angleKey = `creator_angle:${input.company_id}:${input.angle_used}`;
  await redis.incr(angleKey);
  await redis.expire(angleKey, 2592000);

  console.debug('[contentFeedbackLoop] Creator feedback recorded', {
    company_id: input.company_id,
    content_type: input.content_type,
    theme: input.theme_used,
    angle: input.angle_used,
    platforms: input.platforms,
  });
}

/**
 * Get creator content theme effectiveness scores
 * Helps future generation choose optimal themes
 */
export async function getCreatorThemeEffectiveness(
  company_id: string
): Promise<Record<string, number>> {
  const redis = getSharedRedisClient();
  const pattern = `creator_theme:${company_id}:*`;
  const keys = await redis.keys(pattern);

  const themes: Record<string, number> = {};
  for (const key of keys) {
    const theme = key.split(':')[2];
    const count = await redis.get(key);
    themes[theme] = parseInt(count || '0', 10);
  }

  return themes;
}

/**
 * Get creator content angle effectiveness scores
 * Helps future generation choose optimal narrative angles
 */
export async function getCreatorAngleEffectiveness(
  company_id: string
): Promise<Record<string, number>> {
  const redis = getSharedRedisClient();
  const pattern = `creator_angle:${company_id}:*`;
  const keys = await redis.keys(pattern);

  const angles: Record<string, number> = {};
  for (const key of keys) {
    const angle = key.split(':')[2];
    const count = await redis.get(key);
    angles[angle] = parseInt(count || '0', 10);
  }

  return angles;
}

