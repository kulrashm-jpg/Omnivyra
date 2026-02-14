/**
 * Baseline Conditioning Scenario Test
 *
 * Runs Scenario 1 (Underdeveloped + Lead Heavy) and Scenario 2 (Strong + Lead Heavy)
 * to validate that baseline conditioning modulates CTA pacing and phase structure.
 *
 * Requires: OPENAI_API_KEY in .env.local, Supabase configured, existing company
 *
 * Run: npx ts-node scripts/run-baseline-conditioning-scenarios.ts
 * Or:  npx tsx scripts/run-baseline-conditioning-scenarios.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { supabase } from '../backend/db/supabaseClient';
import { runCampaignAiPlan } from '../backend/services/campaignAiOrchestrator';
import { computeExpectedBaseline, classifyBaseline } from '../backend/services/baselineClassificationService';

const LEAD_HEAVY_WEIGHTS = { lead_generation: 100 };
const MESSAGE = 'Generate a 12-week content plan focused on lead generation. Include weekly themes and daily content ideas with CTAs.';

type ScenarioResult = {
  scenario: string;
  baselineStatus: 'underdeveloped' | 'aligned' | 'strong';
  rawPlan: string;
  planLength: number;
  week1Text: string;
  findings: string[];
  passed: boolean;
  failureReasons: string[];
};

function extractWeek1Section(text: string): string {
  const lower = text.toLowerCase();
  const week1Start = lower.search(/\bweek\s*1\b/);
  if (week1Start < 0) return text.slice(0, 1200);
  const week2Start = lower.indexOf('week 2', week1Start + 5);
  if (week2Start > week1Start) {
    return text.slice(week1Start, week2Start);
  }
  return text.slice(week1Start, week1Start + 1200);
}

function evaluateScenario1(rawPlan: string): { passed: boolean; findings: string[]; failureReasons: string[] } {
  const findings: string[] = [];
  const failureReasons: string[] = [];
  const lower = rawPlan.toLowerCase();
  const week1 = extractWeek1Section(rawPlan);

  // FAIL: Aggressive conversion CTA in Week 1
  const aggressiveCtas = [
    'book your session',
    'book a call',
    'schedule a call',
    'book now',
    'sign up now',
    'register now',
    'get started now',
  ];
  const hasAggressiveCta = aggressiveCtas.some((cta) => week1.includes(cta));
  if (hasAggressiveCta) {
    failureReasons.push(`Week 1 contains aggressive conversion CTA (e.g. "Book your session now")`);
  } else {
    findings.push('✓ No aggressive conversion CTA in Week 1');
  }

  // PASS: Awareness/audience-building language
  const awarenessTerms = ['awareness', 'audience', 'build', 'introduce', 'discover', 'educate', 'value'];
  const hasAwareness = awarenessTerms.some((t) => week1.includes(t));
  if (hasAwareness) {
    findings.push('✓ Awareness/audience-building phase present');
  } else {
    failureReasons.push('Missing explicit awareness/activation phase');
  }

  // PASS: Conversion ramp mentioned for Week 2-3
  const week2to3 = lower.slice(lower.indexOf('week 2') >= 0 ? lower.indexOf('week 2') : 0);
  const rampTerms = ['week 2', 'week 3', 'conversion', 'cta', 'lead', 'ramp'];
  const hasRamp = rampTerms.filter((t) => week2to3.includes(t)).length >= 2;
  if (hasRamp) {
    findings.push('✓ Conversion ramp in Week 2-3 region');
  } else {
    findings.push('○ Conversion ramp timing unclear');
  }

  const passed = failureReasons.length === 0;
  return { passed, findings, failureReasons };
}

function evaluateScenario2(rawPlan: string): { passed: boolean; findings: string[]; failureReasons: string[] } {
  const findings: string[] = [];
  const failureReasons: string[] = [];
  const lower = rawPlan.toLowerCase();
  const week1 = extractWeek1Section(rawPlan);

  // PASS: Direct CTA present in Week 1
  const ctaTerms = ['cta', 'call to action', 'book', 'sign up', 'register', 'download', 'lead'];
  const hasDirectCta = ctaTerms.some((t) => week1.includes(t));
  if (hasDirectCta) {
    findings.push('✓ Direct CTA present in Week 1');
  } else {
    failureReasons.push('Week 1 lacks direct conversion CTA');
  }

  // PASS: Conversion-forward language
  const conversionTerms = ['lead', 'conversion', 'sign up', 'book', 'cta', 'conversion'];
  const hasConversion = conversionTerms.some((t) => week1.includes(t));
  if (hasConversion) {
    findings.push('✓ Conversion-forward language in Week 1');
  } else {
    failureReasons.push('Week 1 lacks conversion-forward language');
  }

  // FAIL: 3-4 weeks warming up (strong baseline should have shorter ramp)
  const fullText = lower;
  const warmingPhrases = ['weeks 1-4', 'weeks 1-3', 'first 4 weeks', 'first 3 weeks', 'warm up', 'warming'];
  const longWarmup = warmingPhrases.some((p) => fullText.includes(p));
  if (longWarmup) {
    failureReasons.push('Plan spends 3-4 weeks warming up (strong baseline should have shorter ramp-up)');
  } else {
    findings.push('✓ No extended 3-4 week warm-up phase');
  }

  const passed = failureReasons.length === 0;
  return { passed, findings, failureReasons };
}

async function runScenario(
  scenarioName: string,
  followersForScenario: number,
  evaluate: (raw: string) => { passed: boolean; findings: string[]; failureReasons: string[] }
): Promise<ScenarioResult> {
  const expected = computeExpectedBaseline('early_stage', 'niche');
  const classification = classifyBaseline(followersForScenario, expected);

  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('company_id, user_id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  const companyId = roleRow?.company_id;
  const userId = roleRow?.user_id;
  if (!companyId || !userId) {
    throw new Error('No company_id/user_id found. Ensure user_company_roles has active entries.');
  }

  const { data: campaign, error: campErr } = await (supabase as any)
    .from('campaigns')
    .insert({
      name: `Baseline Test: ${scenarioName}`,
      description: `Scenario: ${scenarioName}`,
      status: 'draft',
      current_stage: 'planning',
      user_id: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (campErr || !campaign) {
    throw new Error(`Failed to create campaign: ${campErr?.message || 'Unknown'}`);
  }

  // Use platform_metrics_snapshots for baseline (getLatestSnapshotsPerPlatform uses latest per platform)
  await (supabase as any)
    .from('platform_metrics_snapshots')
    .insert({
      company_id: companyId,
      platform: 'linkedin',
      followers: followersForScenario,
      engagement_rate: 0.02,
      captured_at: new Date().toISOString(),
    });

  // Minimal insert - only columns that exist in base schema; migrations may add build_mode, campaign_types, etc.
  const versionPayload: Record<string, unknown> = {
    company_id: companyId,
    campaign_id: campaign.id,
    campaign_snapshot: {
      campaign: null,
      campaign_types: ['lead_generation'],
      campaign_weights: LEAD_HEAVY_WEIGHTS,
    },
    status: 'draft',
    version: 1,
    created_at: new Date().toISOString(),
  };
  const { error: verErr } = await (supabase as any).from('campaign_versions').insert(versionPayload);

  if (verErr) {
    throw new Error(`Failed to create campaign version: ${verErr.message}`);
  }

  const result = await runCampaignAiPlan({
    campaignId: campaign.id,
    mode: 'generate_plan',
    message: MESSAGE,
    durationWeeks: 12,
  });

  const rawPlan = result.raw_plan_text || '';
  const ev = evaluate(rawPlan);
  const week1 = extractWeek1Section(rawPlan);

  await (supabase as any).from('campaign_versions').delete().eq('campaign_id', campaign.id);
  await (supabase as any).from('campaigns').delete().eq('id', campaign.id);

  return {
    scenario: scenarioName,
    baselineStatus: classification.status,
    rawPlan,
    planLength: rawPlan.length,
    week1Text: week1.slice(0, 800),
    findings: ev.findings,
    passed: ev.passed,
    failureReasons: ev.failureReasons,
  };
}

async function main() {
  console.log('=== Baseline Conditioning Scenario Test ===\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY required. Add to .env.local');
    process.exit(1);
  }

  const report: string[] = [];
  report.push('# Baseline Conditioning Scenario Report');
  report.push('');
  report.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  report.push('');
  report.push('---');
  report.push('');

  try {
    // Scenario 1: Underdeveloped (followers << expected)
    report.push('## Scenario 1 — Underdeveloped + Lead Heavy');
    report.push('');
    report.push('**Configuration:** company_stage=early_stage, market_scope=niche, baseline_override={ followers: 50 }');
    report.push('**Expected baseline status:** underdeveloped (ratio < 0.5)');
    report.push('');
    report.push('**Expected behavior:**');
    report.push('- Week 1: No aggressive conversion CTA');
    report.push('- Clear audience-building phase');
    report.push('- Explicit awareness activation');
    report.push('- Conversion ramp starting Week 2–3');
    report.push('- Lead intent preserved, not abandoned');
    report.push('');

    console.log('Running Scenario 1 (Underdeveloped + Lead Heavy)...');
    const s1 = await runScenario('Underdeveloped', 50, evaluateScenario1);

    report.push('**Result:** ' + (s1.passed ? '🟢 PASSED' : '🔴 FAILED'));
    report.push('');
    report.push('**Findings:**');
    s1.findings.forEach((f) => report.push(`- ${f}`));
    if (s1.failureReasons.length > 0) {
      report.push('');
      report.push('**Failure reasons:**');
      s1.failureReasons.forEach((r) => report.push(`- ${r}`));
    }
    report.push('');
    report.push('**Week 1 excerpt:**');
    report.push('```');
    report.push(s1.week1Text.slice(0, 600));
    report.push('```');
    report.push('');
    report.push('---');
    report.push('');

    // Scenario 2: Strong (followers >> expected)
    report.push('## Scenario 2 — Strong + Lead Heavy');
    report.push('');
    report.push('**Configuration:** company_stage=early_stage, market_scope=niche, baseline_override={ followers: 500 }');
    report.push('**Expected baseline status:** strong (ratio > 1.2)');
    report.push('');
    report.push('**Expected behavior:**');
    report.push('- Week 1: Direct CTA present');
    report.push('- Conversion-forward language');
    report.push('- Minimal awareness-only stage');
    report.push('- Platform emphasis toward conversion channels');
    report.push('- Shorter ramp-up (no 3-4 week warm-up)');
    report.push('');

    console.log('Running Scenario 2 (Strong + Lead Heavy)...');
    const s2 = await runScenario('Strong', 500, evaluateScenario2);

    report.push('**Result:** ' + (s2.passed ? '🟢 PASSED' : '🔴 FAILED'));
    report.push('');
    report.push('**Findings:**');
    s2.findings.forEach((f) => report.push(`- ${f}`));
    if (s2.failureReasons.length > 0) {
      report.push('');
      report.push('**Failure reasons:**');
      s2.failureReasons.forEach((r) => report.push(`- ${r}`));
    }
    report.push('');
    report.push('**Week 1 excerpt:**');
    report.push('```');
    report.push(s2.week1Text.slice(0, 600));
    report.push('```');
    report.push('');
    report.push('---');
    report.push('');

    report.push('## Summary');
    report.push('');
    report.push('| Scenario | Baseline | Result |');
    report.push('|----------|----------|--------|');
    report.push(`| Scenario 1 (Underdeveloped) | ${s1.baselineStatus} | ${s1.passed ? '🟢 PASS' : '🔴 FAIL'} |`);
    report.push(`| Scenario 2 (Strong) | ${s2.baselineStatus} | ${s2.passed ? '🟢 PASS' : '🔴 FAIL'} |`);
    report.push('');
    report.push('**Verdict:**');
    if (s1.passed && s2.passed) {
      report.push('✅ Baseline conditioning is working as expected.');
    } else if (!s1.passed && s2.passed) {
      report.push('⚠️ Underdeveloped conditioning is weak. Plans may start with aggressive CTAs despite low baseline.');
    } else if (s1.passed && !s2.passed) {
      report.push('⚠️ Strong baseline conditioning is weak. Plans may still spend 3-4 weeks warming up.');
    } else {
      report.push('❌ Both scenario conditionings need improvement.');
    }

    const reportPath = path.join(process.cwd(), 'docs', 'BASELINE_CONDITIONING_SCENARIO_REPORT.md');
    fs.writeFileSync(reportPath, report.join('\n'), 'utf-8');
    console.log(`\nReport written to ${reportPath}`);
    console.log(report.join('\n'));
  } catch (e) {
    console.error(e);
    report.push('');
    report.push('## Error');
    report.push('');
    report.push(`\`\`\`\n${(e as Error).message}\n\`\`\``);
    fs.writeFileSync(
      path.join(process.cwd(), 'docs', 'BASELINE_CONDITIONING_SCENARIO_REPORT.md'),
      report.join('\n'),
      'utf-8'
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
