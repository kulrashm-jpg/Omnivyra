/**
 * Engagement Signal Scheduler
 * Runs collectors for activities that have published posts (external_post_id IS NOT NULL).
 * Runs every 15 minutes with overlap prevention.
 */

import { supabase } from '../db/supabaseClient';
import {
  collectLinkedInSignals,
  collectTwitterSignals,
  collectCommunitySignals,
} from '../services/engagementSignalCollector';

const JOB_LOCK_KEY = 'engagement_signal_collection_lock';
const LOCK_TTL_MS = 14 * 60 * 1000; // 14 min (less than 15 min interval)

let lastRunTime = 0;
let isRunning = false;
const collectorErrors: string[] = [];
const MAX_ERRORS_RETAINED = 50;

export type EngagementSignalSchedulerResult = {
  activities_processed: number;
  linkedin_count: number;
  twitter_count: number;
  community_count: number;
  errors: string[];
  last_run_time: string | null;
};

export async function runEngagementSignalScheduler(): Promise<EngagementSignalSchedulerResult> {
  if (isRunning) {
    return {
      activities_processed: 0,
      linkedin_count: 0,
      twitter_count: 0,
      community_count: 0,
      errors: ['Skipped: previous run still in progress'],
      last_run_time: lastRunTime ? new Date(lastRunTime).toISOString() : null,
    };
  }

  const now = Date.now();
  if (lastRunTime && now - lastRunTime < LOCK_TTL_MS) {
    return {
      activities_processed: 0,
      linkedin_count: 0,
      twitter_count: 0,
      community_count: 0,
      errors: [],
      last_run_time: new Date(lastRunTime).toISOString(),
    };
  }

  isRunning = true;
  lastRunTime = now;
  collectorErrors.length = 0;

  let activitiesProcessed = 0;
  let linkedinCount = 0;
  let twitterCount = 0;
  let communityCount = 0;

  try {
    const { data: plans, error } = await supabase
      .from('daily_content_plans')
      .select('id, execution_id')
      .not('external_post_id', 'is', null)
      .limit(200);

    if (error) {
      collectorErrors.push(`Query error: ${error.message}`);
      return { activities_processed: 0, linkedin_count: 0, twitter_count: 0, community_count: 0, errors: collectorErrors, last_run_time: new Date(lastRunTime).toISOString() };
    }

    const activityIds = new Set<string>();
    for (const p of plans ?? []) {
      const id = (p as { id: string }).id;
      const execId = (p as { execution_id?: string }).execution_id;
      activityIds.add(id);
      if (execId) activityIds.add(execId);
    }

    for (const activityId of activityIds) {
      try {
        const li = await collectLinkedInSignals(activityId);
        const tw = await collectTwitterSignals(activityId);
        const cm = await collectCommunitySignals(activityId);
        linkedinCount += li;
        twitterCount += tw;
        communityCount += cm;
        if (li > 0 || tw > 0 || cm > 0) activitiesProcessed++;
      } catch (err) {
        const msg = (err as Error)?.message ?? 'Unknown error';
        collectorErrors.push(`Activity ${activityId}: ${msg}`);
        if (collectorErrors.length >= MAX_ERRORS_RETAINED) break;
      }
    }

    return {
      activities_processed: activitiesProcessed,
      linkedin_count: linkedinCount,
      twitter_count: twitterCount,
      community_count: communityCount,
      errors: [...collectorErrors],
      last_run_time: new Date(lastRunTime).toISOString(),
    };
  } finally {
    isRunning = false;
  }
}

export function getEngagementSignalSchedulerLastRun(): number {
  return lastRunTime;
}

export function getEngagementSignalSchedulerErrors(): string[] {
  return [...collectorErrors];
}
