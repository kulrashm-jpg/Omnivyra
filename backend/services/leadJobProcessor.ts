import { ownedDbTable } from '../db/writeOwner';
/**
 * Active Leads Engine v1/v2 processor.
 * Modes: REACTIVE (explicit) / PREDICTIVE (latent). Dedupe by dedupe_hash, fail-soft per platform, confidence_index.
 */

import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import { getProfile } from './companyProfileService';
import { buildUnifiedContext } from './contextResolver';
import { getConnector } from './postDiscoveryConnectors';
import type { RawPost } from './postDiscoveryConnectors/types';
import { qualifyLead } from './leadQualifier';
import { qualifyPredictiveLead } from './leadPredictiveQualifier';
import { shouldRejectPost } from './leadNoiseFilter';
import { generateIntentClusters } from './leadClusterService';
import { writeLeadSignal } from './canonicalLeadSignalService';
import { deductCreditsIfValueAwaited } from './creditExecutionService';

const QUALIFIED_THRESHOLD = 0.6;
const QUALITY_WEIGHT = 0.7;
const ENGAGEMENT_WEIGHT = 0.3;

const PLATFORM_WEIGHT: Record<string, number> = {
  reddit: 0.1,
  linkedin: 0.15,
  instagram: -0.05,
  facebook: 0,
  twitter: -0.05,
  x: -0.05,
  hackernews: 0.1,
};

type LeadContextPayload = {
  context_mode?: string;
  focused_modules?: string[];
  additional_direction?: string;
};

type LeadJobRow = {
  id: string;
  company_id: string;
  mode: string | null;
  platforms: string[];
  regions: string[];
  keywords: string[] | null;
  status: string;
  total_found: number;
  total_qualified: number;
  context_payload?: LeadContextPayload | null;
};

function computeContentHash(platform: string, rawText: string): string {
  const payload = platform + (rawText || '').trim().toLowerCase();
  return createHash('sha256').update(payload).digest('hex');
}

function computeDedupeHash(platform: string, author: string, snippet: string): string {
  const payload = platform + (author || '').trim() + (snippet || '').trim();
  return createHash('sha256').update(payload).digest('hex');
}

function getPlatformWeight(platform: string): number {
  return PLATFORM_WEIGHT[platform?.toLowerCase()] ?? 0;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number(n)));
}

export async function processLeadJobV1(jobId: string): Promise<void> {
  try {
  console.info({ jobId, phase: 'STARTED' });

  const { data: job, error: fetchError } = await ownedDbTable('lead_jobs_v1')
    .select('id, company_id, status, mode, platforms, regions, keywords, context_payload')
    .eq('id', jobId)
    .single();

  if (fetchError || !job) {
    return;
  }

  const row = job as LeadJobRow;
  const terminalStatuses = ['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'];
  if (terminalStatuses.includes(row.status)) {
    return;
  }

  if (row.status === 'PENDING') {
    await ownedDbTable('lead_jobs_v1')
      .update({ status: 'RUNNING', progress_stage: 'INITIALIZING' })
      .eq('id', jobId);
  }

  const companyId = row.company_id;
  const mode = row.mode === 'PREDICTIVE' ? 'PREDICTIVE' : 'REACTIVE';
  const platforms = Array.isArray(row.platforms) ? row.platforms : [];
  const regions = Array.isArray(row.regions) && row.regions.length > 0 ? row.regions : ['GLOBAL'];
  const keywords = Array.isArray(row.keywords) ? row.keywords : [];

  let totalFound = 0;
  let totalQualified = 0;
  let platformFailures = 0;
  let riskCount = 0;
  const platformErrors: { platform: string; error: string }[] = [];
  const regionsWithSignals = new Set<string>();
  const qualifiedScores: number[] = [];
  const scoresByPlatform: Record<string, number[]> = {};
  const predictiveTrendVelocities: number[] = [];
  const predictiveConversionWindows: number[] = [];

  const profile = await getProfile(companyId);
  const contextPayload = row.context_payload ?? null;
  const contextMode = (contextPayload?.context_mode ?? 'FULL') as 'FULL' | 'FOCUSED' | 'NONE';
  const unifiedContextBlock = await buildUnifiedContext(companyId, {
    mode: contextMode,
    selectedModules: (contextPayload?.focused_modules ?? []) as import('./contextResolver').FocusModule[],
    additionalDirection: contextPayload?.additional_direction,
  });

  for (const platform of platforms) {
    await ownedDbTable('lead_jobs_v1').update({ progress_stage: 'SCANNING' }).eq('id', jobId);
    const connector = getConnector(platform);
    if (!connector) {
      platformFailures++;
      platformErrors.push({ platform, error: 'Connector not found' });
      continue;
    }

    let platformFound = 0;
    let platformQualified = 0;

    try {
      if (!scoresByPlatform[platform]) scoresByPlatform[platform] = [];
      let qualifyingStageSet = false;

      for (const region of regions) {
        const posts: RawPost[] = await connector({ region, keywords });
        for (const post of posts) {
          if (shouldRejectPost(post.raw_text)) continue;
          if (!qualifyingStageSet) {
            await ownedDbTable('lead_jobs_v1').update({ progress_stage: 'QUALIFYING' }).eq('id', jobId);
            qualifyingStageSet = true;
          }

          const dedupeHash = computeDedupeHash(
            post.platform,
            post.author_handle ?? '',
            post.snippet ?? ''
          );

          const canonicalSourceId =
            (post.source_url ?? '').toString().trim() || dedupeHash;

          const { data: existingDedupe } = await ownedDbTable('lead_signals')
            .select('id')
            .eq('organization_id', companyId)
            .eq('source_type', 'listening')
            .eq('source_id', canonicalSourceId)
            .limit(1)
            .maybeSingle();

          if (existingDedupe) continue;

          const authorHandle = (post.author_handle ?? '').trim();

          const contentHash = computeContentHash(post.platform, post.raw_text);
          const postedAt = post.posted_at ?? null;
          const postCreatedAt = post.posted_at ?? postedAt ?? new Date().toISOString();
          let canonicalIntentScore = 0;
          let canonicalUrgencyScore = 0;
          let canonicalIcpScore = 0;
          let canonicalConfidenceScore = 0;
          let canonicalTotalScore = 0;
          let canonicalMetadata: Record<string, unknown> = {
            region: post.region ?? region,
            source_url: post.source_url,
            language: post.language ?? null,
            content_hash: contentHash,
            dedupe_hash: dedupeHash,
            posted_at: postedAt,
            post_created_at: postCreatedAt,
            job_id: jobId,
            mode,
          };

          if (mode === 'REACTIVE') {
            const qual = await qualifyLead(post, profile, null, unifiedContextBlock);
            const qualityScore = qual.total_score;
            const engagement = qual.engagement_potential ?? 0;
            const combined = qualityScore * QUALITY_WEIGHT + engagement * ENGAGEMENT_WEIGHT;
            const platformWeight = getPlatformWeight(post.platform);
            const total_score = clamp01(combined + platformWeight);

            const qualified = total_score >= QUALIFIED_THRESHOLD && !qual.risk_flag;
            if (qual.risk_flag) riskCount++;
            if (qualified) {
              totalQualified++;
              platformQualified++;
              qualifiedScores.push(total_score);
              scoresByPlatform[platform].push(total_score);
            }
            canonicalIntentScore = qual.intent_score;
            canonicalUrgencyScore = qual.urgency_score;
            canonicalIcpScore = qual.icp_score;
            canonicalConfidenceScore = total_score;
            canonicalTotalScore = total_score;
            canonicalMetadata = {
              ...canonicalMetadata,
              engagement_potential: engagement,
              risk_flag: qual.risk_flag,
              signal_type: 'EXPLICIT',
              problem_domain: qual.problem_domain ?? null,
            };
          } else {
            const qual = await qualifyPredictiveLead(post, profile, null, unifiedContextBlock);
            const total_score = qual.total_score;
            const qualified = total_score >= QUALIFIED_THRESHOLD && !qual.risk_flag;
            if (qual.risk_flag) riskCount++;
            if (qualified) {
              totalQualified++;
              platformQualified++;
              qualifiedScores.push(total_score);
              scoresByPlatform[platform].push(total_score);
              predictiveTrendVelocities.push(qual.trend_velocity);
              predictiveConversionWindows.push(qual.conversion_window_days);
            }
            canonicalIntentScore = qual.intent_score;
            canonicalUrgencyScore = qual.urgency_score;
            canonicalIcpScore = qual.icp_score;
            canonicalConfidenceScore = total_score;
            canonicalTotalScore = total_score;
            canonicalMetadata = {
              ...canonicalMetadata,
              engagement_potential: 0,
              risk_flag: qual.risk_flag,
              signal_type: 'LATENT',
              trend_velocity: qual.trend_velocity,
              conversion_window_days: qual.conversion_window_days,
              problem_domain: qual.problem_domain ?? null,
            };
          }

          await writeLeadSignal({
            debugContext: 'leadJobProcessor.processLeadJobV1',
            canonical: {
              organization_id: companyId,
              source_type: 'listening',
              source_id: canonicalSourceId,
              thread_id: null,
              platform: post.platform,
              platform_user_id: authorHandle || null,
              content_text: post.raw_text,
              intent_score: canonicalIntentScore,
              urgency_score: canonicalUrgencyScore,
              icp_score: canonicalIcpScore,
              confidence_score: canonicalConfidenceScore,
              total_score: canonicalTotalScore,
              detected_at: postCreatedAt,
              migration_source: 'native',
              metadata: canonicalMetadata,
            },
          });

          totalFound++;
          platformFound++;
          try {
            await supabase.rpc('lead_platform_increment_signals', {
              p_company_id: companyId,
              p_platform: (post.platform ?? platform).toString().toLowerCase(),
            });
          } catch {
            // platform stats are non-critical
          }
          regionsWithSignals.add((post.region ?? region) as string);
        }
      }

      if (platformFound > 0 || platformQualified > 0) {
        console.info({
          jobId,
          platform,
          regionCount: regions.length,
          found: platformFound,
          qualified: platformQualified,
        });
      }
    } catch (err) {
      platformFailures++;
      platformErrors.push({
        platform,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    console.info({ jobId, platform, phase: 'PLATFORM_DONE' });

    await ownedDbTable('lead_jobs_v1')
      .update({
        total_found: totalFound,
        total_qualified: totalQualified,
      })
      .eq('id', jobId);
  }

  const finalStatus =
    platformFailures > 0 && (totalFound > 0 || totalQualified > 0)
      ? 'COMPLETED_WITH_WARNINGS'
      : totalFound === 0 && platformFailures === platforms.length
        ? 'FAILED'
        : 'COMPLETED';

  let confidence_index = 0;
  const qualifiedRatio = totalFound > 0 ? totalQualified / totalFound : 0;
  const riskRatio = totalFound > 0 ? riskCount / totalFound : 0;
  const regionCount = regionsWithSignals.size;

  if (totalQualified === 0) {
    confidence_index = 10;
  } else {
    if (totalQualified >= 10) confidence_index += 30;
    if (qualifiedRatio > 0.3) confidence_index += 30;
    if (regionCount > 1) confidence_index += 20;
    if (riskRatio < 0.2) confidence_index += 20;
    if (totalFound > 100) confidence_index += 10;
    if (mode === 'PREDICTIVE') {
      const avgTrendVelocity =
        predictiveTrendVelocities.length > 0
          ? predictiveTrendVelocities.reduce((a, b) => a + b, 0) / predictiveTrendVelocities.length
          : 0;
      const avgConversionWindow =
        predictiveConversionWindows.length > 0
          ? predictiveConversionWindows.reduce((a, b) => a + b, 0) / predictiveConversionWindows.length
          : 60;
      if (avgTrendVelocity > 0.5) confidence_index += 20;
      if (avgConversionWindow < 21) confidence_index += 20;
    }
    confidence_index = Math.min(100, confidence_index);
  }

  console.info({ jobId, finalStatus, phase: 'COMPLETING' });

  const { data: updatedRow, error: updateError } = await ownedDbTable('lead_jobs_v1')
    .update({
      status: finalStatus,
      total_found: totalFound,
      total_qualified: totalQualified,
      confidence_index,
      completed_at: new Date().toISOString()
    })
    .eq('id', jobId)
    .select('*');

  const updateCount = Array.isArray(updatedRow) ? updatedRow.length : updatedRow ? 1 : 0;
  console.info({
    jobId,
    updateData: updatedRow,
    updateError: updateError ?? null,
    updateCount,
  });

  if (updateError) {
    console.error('❌ FINAL UPDATE FAILED', updateError);
  } else if (updateCount === 0) {
    console.error('❌ FINAL UPDATE AFFECTED 0 ROWS', { jobId, updateCount });
  } else {
    const row = Array.isArray(updatedRow) ? updatedRow[0] : updatedRow;
    console.info('✅ FINAL UPDATE SUCCESS', row?.status);
  }

  // Credit capture — charge per QUALIFIED lead (value-gated). Best-effort:
  // never blocks or fails the scan. Idempotent on jobId (multiplier scales the
  // catalog price by the qualified-lead count). The per-post LLM token cost is
  // metered separately in usage_events via the process_type → action_key map.
  if (
    (finalStatus === 'COMPLETED' || finalStatus === 'COMPLETED_WITH_WARNINGS') &&
    totalQualified > 0
  ) {
    const leadAction = mode === 'PREDICTIVE' ? 'lead_predictive_scoring' : 'lead_qualification';
    try {
      await deductCreditsIfValueAwaited(
        companyId,
        leadAction,
        true,
        {
          referenceId: jobId,
          multiplier: totalQualified,
          note: `Lead ${mode.toLowerCase()} scan ${jobId}: ${totalQualified} qualified`,
        },
        false, // per-job idempotency via jobId; no smart-mode time-window dedup
      );
    } catch {
      // billing is best-effort — must never affect job completion
    }
  }

  if (finalStatus === 'COMPLETED' || finalStatus === 'COMPLETED_WITH_WARNINGS') {
    await ownedDbTable('lead_jobs_v1').update({ progress_stage: 'CLUSTERING' }).eq('id', jobId);
    try {
      await generateIntentClusters(companyId);
    } catch {
      // cluster failures must not affect job completion
    }
  }

  console.info({ jobId, phase: 'FINISHED' });

  console.info({
    jobId,
    status: finalStatus,
    completedAt: new Date().toISOString(),
    marker: 'FINAL_DB_UPDATE_DONE',
  });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error({
      jobId,
      error: message,
      marker: 'PROCESSOR_CRASHED',
    });
    console.error('Lead Job Processor Error:', err);
    await ownedDbTable('lead_jobs_v1')
      .update({
        status: 'FAILED',
        error: message,
        progress_stage: 'FINISHED',
      })
      .eq('id', jobId);
  }
}
