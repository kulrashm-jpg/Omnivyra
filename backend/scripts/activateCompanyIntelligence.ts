/**
 * Activate Company-Level Intelligence Distribution
 * Run: npx ts-node backend/scripts/activateCompanyIntelligence.ts
 *
 * 1. Fetches companies
 * 2. Inserts default topics, keywords, competitors for each company
 * 3. Triggers distributeSignalsToCompanies with all signal IDs
 * 4. Outputs verification report
 */

import { supabase } from '../db/supabaseClient';
import { distributeSignalsToCompanies } from '../services/companySignalDistributionService';

const DEFAULT_TOPICS = ['AI', 'marketing automation', 'SaaS tools'];
const DEFAULT_KEYWORDS = ['artificial intelligence', 'automation software'];
const DEFAULT_COMPETITORS = ['OpenAI', 'HubSpot'];

async function main() {
  const report: string[] = [];
  report.push('# Company Intelligence Activation Report');
  report.push('');
  report.push('**Date:** ' + new Date().toISOString());
  report.push('');

  // PART 1 — Companies
  const { data: companies, error: companiesError } = await supabase
    .from('companies')
    .select('id, name')
    .limit(10);

  if (companiesError) {
    report.push('## 1 — Companies Detected');
    report.push('');
    report.push('**Error:** ' + companiesError.message);
    console.log(report.join('\n'));
    return;
  }

  const companyList = companies ?? [];
  report.push('## 1 — Companies Detected');
  report.push('');
  report.push('| id | name |');
  report.push('|----|------|');
  for (const c of companyList) {
    report.push(`| ${c.id} | ${(c.name ?? '-').slice(0, 40)} |`);
  }
  if (companyList.length === 0) {
    report.push('*(no companies)*');
  }
  report.push('');

  if (companyList.length === 0) {
    report.push('**No companies found. Skipping activation.**');
    console.log(report.join('\n'));
    return;
  }

  // PART 2 — Topics
  let topicsInserted = 0;
  for (const company of companyList) {
    for (const topic of DEFAULT_TOPICS) {
      const { data: existing } = await supabase
        .from('company_intelligence_topics')
        .select('id')
        .eq('company_id', company.id)
        .eq('topic', topic)
        .maybeSingle();
      if (!existing) {
        const { error } = await supabase.from('company_intelligence_topics').insert({
          company_id: company.id,
          topic,
          enabled: true,
        });
        if (!error) topicsInserted++;
      }
    }
  }
  report.push('## 2 — Topics Enabled');
  report.push('');
  report.push(`Inserted ${topicsInserted} new topic rows. Default topics: ${DEFAULT_TOPICS.join(', ')}`);
  report.push('');

  // PART 3 — Keywords
  let keywordsInserted = 0;
  for (const company of companyList) {
    for (const keyword of DEFAULT_KEYWORDS) {
      const { data: existing } = await supabase
        .from('company_intelligence_keywords')
        .select('id')
        .eq('company_id', company.id)
        .eq('keyword', keyword)
        .maybeSingle();
      if (!existing) {
        const { error } = await supabase.from('company_intelligence_keywords').insert({
          company_id: company.id,
          keyword,
          enabled: true,
        });
        if (!error) keywordsInserted++;
      }
    }
  }
  report.push('## 3 — Keywords Enabled');
  report.push('');
  report.push(`Inserted ${keywordsInserted} new keyword rows. Default keywords: ${DEFAULT_KEYWORDS.join(', ')}`);
  report.push('');

  // PART 4 — Competitors (competitor_name column)
  let competitorsInserted = 0;
  for (const company of companyList) {
    for (const competitor of DEFAULT_COMPETITORS) {
      const { data: existing } = await supabase
        .from('company_intelligence_competitors')
        .select('id')
        .eq('company_id', company.id)
        .eq('competitor_name', competitor)
        .maybeSingle();
      if (!existing) {
        const { error } = await supabase.from('company_intelligence_competitors').insert({
          company_id: company.id,
          competitor_name: competitor,
          enabled: true,
        });
        if (!error) competitorsInserted++;
      }
    }
  }
  report.push('## 4 — Competitors Enabled');
  report.push('');
  report.push(`Inserted ${competitorsInserted} new competitor rows. Default competitors: ${DEFAULT_COMPETITORS.join(', ')}`);
  report.push('');

  // PART 5 — Trigger distribution
  const { data: signals } = await supabase
    .from('intelligence_signals')
    .select('id');
  const signalIds = (signals ?? []).map((s) => s.id);

  report.push('## 5 — Signal Distribution');
  report.push('');
  report.push(`Triggering distributeSignalsToCompanies with ${signalIds.length} signal IDs...`);
  report.push('');

  const distResult = await distributeSignalsToCompanies(signalIds);
  report.push(`**Result:** companiesProcessed=${distResult.companiesProcessed}, totalInserted=${distResult.totalInserted}, totalSkipped=${distResult.totalSkipped}`);
  report.push('');

  // PART 6 — Verify company signals
  const { count: cisCount } = await supabase
    .from('company_intelligence_signals')
    .select('id', { count: 'exact', head: true });

  const { data: cisSample } = await supabase
    .from('company_intelligence_signals')
    .select('company_id, signal_id, relevance_score, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  report.push('## 6 — Company Signal Count');
  report.push('');
  report.push(`\`SELECT COUNT(*) FROM company_intelligence_signals\` → **${cisCount ?? 0}**`);
  report.push('');
  report.push('**Sample (company_id, signal_id, relevance_score, created_at):**');
  if (cisSample?.length) {
    report.push('| company_id | signal_id | relevance_score | created_at |');
    report.push('|------------|-----------|-----------------|------------|');
    for (const r of cisSample) {
      const x = r as { company_id: string; signal_id: string; relevance_score?: number; created_at?: string };
      report.push(`| ${x.company_id?.slice(0, 8)}... | ${x.signal_id?.slice(0, 8)}... | ${x.relevance_score ?? '-'} | ${x.created_at ?? '-'} |`);
    }
  } else {
    report.push('*(none)*');
  }
  report.push('');
  report.push('---');
  console.log(report.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
