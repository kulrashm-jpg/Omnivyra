
/**
 * /api/super-admin/activity-control
 *
 * GET  ?type=global_activities
 *        → all intelligence_global_config rows
 *
 * GET  ?type=company_activities&company_id=<uuid>
 *        → global configs merged with company overrides (resolved)
 *
 * GET  ?type=infra_limits
 *        → InfraLimitsConfig from Redis + current effective limits
 *
 * PATCH body { action: 'update_global_activity',   job_type, ...fields }
 *       body { action: 'update_company_activity',  job_type, company_id, ...fields }
 *       body { action: 'update_infra_limits',       limits: InfraLimitsConfig['redis'|…] }
 *
 * Auth: super_admin_session cookie (HttpOnly) required.
 */

export const runtime = 'nodejs';

import type { NextApiRequest, NextApiResponse } from 'next';
import { config } from '@/config';
import {
  getAllGlobalConfigs,
  getCompanyOverrides,
  updateGlobalConfig,
  upsertCompanyOverride,
  resolveConfig,
  type GlobalConfig,
} from '../../../backend/services/intelligenceConfigService';
import {
  getInfraLimitsConfig,
  saveInfraLimitsConfig,
  DEFAULT_INFRA_LIMITS,
  type InfraLimitsConfig,
} from '../../../backend/services/adminRuntimeConfig';

// Lazy-imported to avoid loading Redis on non-worker processes
let _applyOverride: ((l: { redisMaxCommandsPerDay?: number; redisMaxMemoryBytes?: number }) => void) | null = null;
async function getApplyOverride() {
  if (!_applyOverride) {
    const mod = await import('../../../lib/redis/usageProtection');
    _applyOverride = mod.applyInfraLimitsOverride;
  }
  return _applyOverride;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth guard
// ─────────────────────────────────────────────────────────────────────────────

function isSuperAdmin(req: NextApiRequest): boolean {
  return req.cookies?.super_admin_session === '1';
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity group labels (user-facing → job_type mapping)
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVITY_GROUPS: Record<string, string[]> = {
  'Website Analysis':  ['signal_clustering', 'signal_intelligence', 'intelligence_polling', 'trend_relevance'],
  'Create Campaign':   ['strategic_themes', 'campaign_opportunities', 'content_opportunities', 'narrative_engine'],
  'Blog Create':       ['blog_generation', 'hook_analysis'],
  'Engagement':        ['engagement_capture', 'engagement_polling', 'feedback_intelligence'],
  'Post Publishing':   ['publish', 'community_posts', 'thread_engine'],
};

function groupForJobType(jobType: string): string {
  for (const [group, types] of Object.entries(ACTIVITY_GROUPS)) {
    if (types.includes(jobType)) return group;
  }
  return 'Other';
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { type, company_id } = req.query;

  if (type === 'infra_limits') {
    const infraConfig = await getInfraLimitsConfig();
    // Resolve effective values (admin config overrides config module values)
    const effectiveDailyLimit =
      infraConfig.redis.maxCommandsPerDay > 0
        ? infraConfig.redis.maxCommandsPerDay
        : config.UPSTASH_DAILY_REQUEST_LIMIT;
    const effectiveMemoryBytes =
      infraConfig.redis.maxMemoryBytes > 0
        ? infraConfig.redis.maxMemoryBytes
        : config.REDIS_MAX_BYTES || 256 * 1024 * 1024;

    return res.status(200).json({
      config: infraConfig,
      effective: {
        redis: {
          maxCommandsPerDay: effectiveDailyLimit,
          maxMemoryBytes:    effectiveMemoryBytes,
          maxMemoryMB:       Math.round(effectiveMemoryBytes / (1024 * 1024)),
        },
        db:  infraConfig.db,
        llm: infraConfig.llm,
      },
    });
  }

  if (type === 'global_activities') {
    const configs = await getAllGlobalConfigs();
    const withGroups = configs.map(c => ({ ...c, group: groupForJobType(c.job_type) }));
    return res.status(200).json({ activities: withGroups });
  }

  if (type === 'company_activities') {
    const cid = Array.isArray(company_id) ? company_id[0] : company_id;
    if (!cid) return res.status(400).json({ error: 'company_id required' });

    const [globals, overrides] = await Promise.all([
      getAllGlobalConfigs(),
      getCompanyOverrides(cid),
    ]);
    const overrideMap = new Map(overrides.map(o => [o.job_type, o]));

    const activities = globals.map((g: GlobalConfig) => {
      const override = overrideMap.get(g.job_type) ?? null;
      const resolved = resolveConfig(g, override);
      return {
        ...resolved,
        global_enabled:    g.enabled,
        global_daily_limit: g.daily_job_limit,
        has_override:       !!override,
        override:           override,
        group:              groupForJobType(g.job_type),
      };
    });
    return res.status(200).json({ activities, company_id: cid });
  }

  return res.status(400).json({ error: 'Unknown type. Use global_activities | company_activities | infra_limits' });
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const { action, job_type, company_id, limits, ...fields } = req.body as Record<string, any>;

  if (action === 'update_infra_limits') {
    if (!limits || typeof limits !== 'object') {
      return res.status(400).json({ error: 'limits object required' });
    }
    // Validate
    const redis = limits.redis ?? {};
    const db    = limits.db    ?? {};
    const llm   = limits.llm   ?? {};
    if (redis.maxCommandsPerDay !== undefined && (typeof redis.maxCommandsPerDay !== 'number' || redis.maxCommandsPerDay < 0)) {
      return res.status(400).json({ error: 'redis.maxCommandsPerDay must be a non-negative number' });
    }
    if (redis.maxMemoryBytes !== undefined && (typeof redis.maxMemoryBytes !== 'number' || redis.maxMemoryBytes < 0)) {
      return res.status(400).json({ error: 'redis.maxMemoryBytes must be a non-negative number' });
    }

    const existing = await getInfraLimitsConfig();
    const updated: InfraLimitsConfig = {
      v: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'super_admin',
      redis: {
        maxCommandsPerDay: redis.maxCommandsPerDay ?? existing.redis.maxCommandsPerDay,
        maxMemoryBytes:    redis.maxMemoryBytes    ?? existing.redis.maxMemoryBytes,
      },
      db: {
        maxReadsPerDay:  db.maxReadsPerDay  ?? existing.db.maxReadsPerDay,
        maxWritesPerDay: db.maxWritesPerDay ?? existing.db.maxWritesPerDay,
      },
      llm: {
        maxTokensPerDay: llm.maxTokensPerDay ?? existing.llm.maxTokensPerDay,
      },
    };
    await saveInfraLimitsConfig(updated);

    // Apply immediately to in-process protection engine (best-effort — may not be running in this process)
    try {
      const apply = await getApplyOverride();
      apply({
        redisMaxCommandsPerDay: updated.redis.maxCommandsPerDay || undefined,
        redisMaxMemoryBytes:    updated.redis.maxMemoryBytes    || undefined,
      });
    } catch { /* non-fatal if protection engine not running in this process */ }

    return res.status(200).json({ ok: true, config: updated });
  }

  if (action === 'update_global_activity') {
    if (!job_type) return res.status(400).json({ error: 'job_type required' });
    const allowed: (keyof GlobalConfig)[] = [
      'enabled', 'priority', 'frequency_minutes', 'max_concurrent',
      'timeout_seconds', 'retry_count', 'daily_job_limit', 'model',
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in fields) updates[key] = fields[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid update fields provided' });
    }
    const updated = await updateGlobalConfig(job_type, updates, 'super_admin');
    return res.status(200).json({ ok: true, config: updated });
  }

  if (action === 'update_company_activity') {
    if (!job_type)   return res.status(400).json({ error: 'job_type required' });
    if (!company_id) return res.status(400).json({ error: 'company_id required' });
    const allowed = [
      'enabled', 'priority', 'frequency_minutes', 'max_concurrent',
      'timeout_seconds', 'retry_count', 'daily_job_limit', 'model',
      'boost_until', 'boost_priority', 'boost_frequency_minutes', 'reason',
    ];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in fields) updates[key] = fields[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid update fields provided' });
    }
    const updated = await upsertCompanyOverride(company_id, job_type, updates, 'super_admin');
    return res.status(200).json({ ok: true, config: updated });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.method === 'GET')   return handleGet(req, res);
  if (req.method === 'PATCH') return handlePatch(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
