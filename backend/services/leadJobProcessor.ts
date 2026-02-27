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

const QUALIFIED_THRESHOLD = 0.6;
const TOP_SLOTS_PER_COMPANY = 50;
const QUALITY_WEIGHT = 0.7;
const ENGAGEMENT_WEIGHT = 0.3;

const PLATFORM_WEIGHT: Record<string, number> = {
  reddit: 0.1,
  linkedin: 0.15,
  instagram: -0.05,
  facebook: 0,
  twitter: -0.05,
  x: -0.05,
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

  const { data: job, error: fetchError } = await supabase
    .from('lead_jobs_v1')
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
    await supabase
      .from('lead_jobs_v1')
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
    await supabase.from('lead_jobs_v1').update({ progress_stage: 'SCANNING' }).eq('id', jobId);
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
            await supabase.from('lead_jobs_v1').update({ progress_stage: 'QUALIFYING' }).eq('id', jobId);
            qualifyingStageSet = true;
          }

          const dedupeHash = computeDedupeHash(
            post.platform,
            post.author_handle ?? '',
            post.snippet ?? ''
          );

          const { data: existingDedupe } = await supabase
            .from('lead_signals_v1')
            .select('id')
            .eq('dedupe_hash', dedupeHash)
            .limit(1)
            .maybeSingle();

          if (existingDedupe) continue;

          const authorHandle = (post.author_handle ?? '').trim();
          if (authorHandle) {
            const { data: existingAuthor } = await supabase
              .from('lead_signals_v1')
              .select('id')
              .eq('job_id', jobId)
              .eq('author_handle', authorHandle)
              .eq('status', 'ACTIVE')
              .limit(1)
              .maybeSingle();
            if (existingAuthor) continue;
          }

          const contentHash = computeContentHash(post.platform, post.raw_text);
          const postedAt = post.posted_at ?? null;

          const postCreatedAt = post.posted_at ?? postedAt;
          const insertPayload = {
            job_id: jobId,
            company_id: companyId,
            platform: post.platform,
            region: post.region ?? region,
            raw_text: post.raw_text,
            snippet: post.snippet,
            source_url: post.source_url,
            author_handle: authorHandle || null,
            language: post.language ?? null,
            content_hash: contentHash,
            dedupe_hash: dedupeHash,
            posted_at: postedAt,
            post_created_at: postCreatedAt,
            status: 'ACTIVE',
          };

          const { data: signal, error: insertErr } = await supabase
            .from('lead_signals_v1')
            .insert(insertPayload)
            .select('id')
            .single();

          if (insertErr) {
            if ((insertErr as { code?: string }).code === '23505') continue;
            continue;
          }
          if (!signal) continue;

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

            await supabase
              .from('lead_signals_v1')
              .update({
                icp_score: qual.icp_score,
                urgency_score: qual.urgency_score,
                intent_score: qual.intent_score,
                total_score,
                engagement_potential: engagement,
                risk_flag: qual.risk_flag,
                signal_type: 'EXPLICIT',
                problem_domain: qual.problem_domain ?? null,
              })
              .eq('id', signal.id);
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

            await supabase
              .from('lead_signals_v1')
              .update({
                icp_score: qual.icp_score,
                urgency_score: qual.urgency_score,
                intent_score: qual.intent_score,
                total_score,
                engagement_potential: 0,
                risk_flag: qual.risk_flag,
                signal_type: 'LATENT',
                trend_velocity: qual.trend_velocity,
                conversion_window_days: qual.conversion_window_days,
                problem_domain: qual.problem_domain ?? null,
              })
              .eq('id', signal.id);
          }
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

    await supabase
      .from('lead_jobs_v1')
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

  const { data: allActive } = await supabase
    .from('lead_signals_v1')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'ACTIVE')
    .order('total_score', { ascending: false });

  const list = (allActive ?? []) as { id: string }[];
  const toArchive = list.slice(TOP_SLOTS_PER_COMPANY);
  for (const { id } of toArchive) {
    await supabase.from('lead_signals_v1').update({ status: 'ARCHIVED' }).eq('id', id);
  }

  console.info({ jobId, finalStatus, phase: 'COMPLETING' });

  const { data: updatedRow, error: updateError } = await supabase
    .from('lead_jobs_v1')
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

  if (finalStatus === 'COMPLETED' || finalStatus === 'COMPLETED_WITH_WARNINGS') {
    await supabase.from('lead_jobs_v1').update({ progress_stage: 'CLUSTERING' }).eq('id', jobId);
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
    await supabase
      .from('lead_jobs_v1')
      .update({
        status: 'FAILED',
        error: message,
        progress_stage: 'FINISHED',
      })
      .eq('id', jobId);
  }
}
