const fs = require('fs');
const dotenv = require('dotenv');
process.env.CONTENT_AUDIT_BYPASS_COST_GUARD = '1';

const envCandidates = ['.env.local', '.env', '.env.test'];
for (const envFile of envCandidates) {
  const fullPath = require('path').join(process.cwd(), envFile);
  if (fs.existsSync(fullPath)) {
    dotenv.config({ path: fullPath, override: false });
  }
}

const { writeFileSync } = require('fs');
const path = require('path');

const { runNewsletterGeneration } = require('../lib/newsletter/runNewsletterGeneration');
const { getDefaultNewsletterTemplates, instantiateNewsletterTemplate } = require('../lib/newsletter/defaultNewsletterTemplates');
const { calculateNewsletterQualityScore } = require('../lib/newsletter/newsletterValidation');
const { supabase } = require('../backend/db/supabaseClient');

const WORD_TARGETS = [800, 1200, 1600];
const ANGLES = ['analytical', 'contrarian', 'strategic'];
const DEFAULT_TOPIC = 'How AI workflow automation is changing B2B operations teams';
const PASS_THRESHOLD = 75;
const DEFAULT_COMPANY_ID = process.env.AUDIT_COMPANY_ID || process.env.OMNIVYRA_COMPANY_ID || 'audit-company';

const DEFAULT_COMPANY_CONTEXT = {
  companyName: 'Omnivyra',
  industry: 'AI and growth operations',
  audience: 'B2B founders, marketers, and operations leaders',
  brand_voice: 'Clear, practical, analytical, and confident',
  uniqueValue: 'Actionable operating intelligence for growth teams',
  authorityDomains: ['AI workflows', 'SEO', 'GEO', 'content operations'],
};

function parseArg(flag) {
  const idx = process.argv.findIndex((arg) => arg === flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function makeAngle(topic, angle) {
  if (angle === 'contrarian') {
    return {
      type: 'contrarian',
      label: 'Contrarian',
      title: `Why most teams misunderstand ${topic}`,
      angle_summary: `Challenges the default narrative around ${topic} and replaces it with a more useful operating lens.`,
      hook: `Most teams think ${topic} is just another productivity upgrade. That reading misses the structural change.`,
    };
  }

  if (angle === 'strategic') {
    return {
      type: 'strategic',
      label: 'Strategic',
      title: `The strategic case for ${topic}`,
      angle_summary: `Frames ${topic} through business impact, tradeoffs, and leadership decisions.`,
      hook: `The real question about ${topic} is not whether it is useful, but where it changes leverage for the business.`,
    };
  }

  return {
    type: 'analytical',
    label: 'Analytical',
    title: `${topic}: what operators need to know`,
    angle_summary: `Breaks down the mechanisms, evidence, and practical implications behind ${topic}.`,
    hook: `${topic} matters because it changes how teams make decisions, not just how fast they execute.`,
  };
}

async function resolveAuditCompanyId(explicitCompanyId) {
  if (explicitCompanyId && explicitCompanyId !== 'audit-company') return explicitCompanyId;

  const candidateNames = ['Omnivyra', 'omnivyra'];

  for (const name of candidateNames) {
    const { data } = await supabase
      .from('companies')
      .select('id, name')
      .ilike('name', name)
      .limit(1)
      .maybeSingle();

    if (data?.id) return data.id;
  }

  const { data: fallback } = await supabase
    .from('companies')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return fallback?.id || 'audit-company';
}

async function countPublishedCompanyBlogs(companyId) {
  if (!companyId || companyId === 'audit-company') return 0;
  const { count } = await supabase
    .from('blogs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'published')
    .not('slug', 'is', null);
  return Number(count || 0);
}

async function runOneCombination(topic, wordTarget, template, angle, companyId, auditRunId) {
  const templateBlocks = instantiateNewsletterTemplate(template, wordTarget);
  const result = await runNewsletterGeneration({
    company_id: companyId,
    cache_version: `${auditRunId}:${template.name}:${wordTarget}:${angle}`,
    companyContext: DEFAULT_COMPANY_CONTEXT,
    blogTable: 'blogs',
    contentType: 'newsletter',
    topic,
    intent: 'authority',
    tone: 'expert',
    target_words: wordTarget,
    answers: {
      target_word_count: wordTarget,
      target_audience: DEFAULT_COMPANY_CONTEXT.audience,
    },
    format_type: template.format_type,
    template_name: template.name,
    template_blocks: templateBlocks,
    selected_angle: makeAngle(topic, angle),
    fetchAngleData: async () => null,
    fetchSeriesData: async () => [],
  });

  if (result.needs_clarification || result.mode !== 'full') {
    return {
      wordTarget,
      template: template.name,
      formatType: template.format_type,
      angle,
      totalScore: 0,
      percentage: 0,
      passed: false,
      templateUsed: false,
      h2Count: 0,
      refsCount: 0,
      wordCount: 0,
      issues: ['Generation returned no full draft'],
    };
  }

  const output = result.result;
  const blocks = output.content_blocks;
  const score = calculateNewsletterQualityScore(blocks, {
    title: output.title,
    excerpt: output.excerpt,
    seo_meta_title: output.seo_meta_title,
    seo_meta_description: output.seo_meta_description,
    tags: output.tags,
    target_word_count: wordTarget,
    format_type: template.format_type,
    content_type: 'newsletter',
  });

  return {
    wordTarget,
    template: template.name,
    formatType: template.format_type,
    angle,
    totalScore: score.total,
    percentage: Math.round((score.total / 90) * 100),
    passed: score.total >= PASS_THRESHOLD,
    templateUsed: !!result.template_used,
    breakdown: score.breakdown,
    h2Count: score.meta.h2Count,
    refsCount: score.meta.refsCount,
    wordCount: score.meta.wordCount,
    issues: score.issues.map((issue) => issue.message),
  };
}

function makeFailedRow(wordTarget, template, angle, error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown newsletter audit error');
  return {
    wordTarget,
    template: template.name,
    formatType: template.format_type,
    angle,
    totalScore: 0,
    percentage: 0,
    passed: false,
    templateUsed: false,
    breakdown: {
      structure: 0,
      depth: 0,
      seo: 0,
      geo: 0,
      linking: 0,
    },
    h2Count: 0,
    refsCount: 0,
    wordCount: 0,
    issues: [`Generation failed: ${message}`],
    error: message,
  };
}

async function main() {
  const topic = parseArg('--topic') || DEFAULT_TOPIC;
  const threshold = Number(parseArg('--threshold') || PASS_THRESHOLD);
  const selectedTemplate = (parseArg('--template') || '').trim().toLowerCase();
  const selectedWordTarget = Number(parseArg('--words') || 0);
  const requestedCompanyId = parseArg('--company-id') || DEFAULT_COMPANY_ID;
  const companyId = await resolveAuditCompanyId(requestedCompanyId);
  const auditRunId = `newsletter-audit-${Date.now()}`;
  const publishedCompanyBlogCount = await countPublishedCompanyBlogs(companyId);

  const allTemplates = getDefaultNewsletterTemplates();
  const templates = selectedTemplate
    ? allTemplates.filter((template) => template.name.toLowerCase() === selectedTemplate)
    : allTemplates;
  const wordTargets = selectedWordTarget && WORD_TARGETS.includes(selectedWordTarget)
    ? [selectedWordTarget]
    : [...WORD_TARGETS];

  if (templates.length === 0) {
    throw new Error(`No newsletter template found for "${selectedTemplate}"`);
  }

  const rows = [];
  for (const wordTarget of wordTargets) {
    for (const template of templates) {
      for (const angle of ANGLES) {
        console.log(`Running ${wordTarget}+ | ${template.name} | ${angle}`);
        let row;
        try {
          row = await runOneCombination(topic, wordTarget, template, angle, companyId, auditRunId);
        } catch (error) {
          console.error(`[audit-newsletter-combinations] Combination failed: ${wordTarget}+ | ${template.name} | ${angle}`, error);
          row = makeFailedRow(wordTarget, template, angle, error);
        }
        row.passed = row.totalScore >= threshold;
        rows.push(row);
      }
    }
  }

  const passed = rows.filter((row) => row.passed);
  const failed = rows.filter((row) => !row.passed);
  const summary = {
    topic,
    companyId,
    auditRunId,
    publishedCompanyBlogCount,
    threshold,
    total: rows.length,
    passed: passed.length,
    failed: failed.length,
    averageScore: rows.length > 0 ? Math.round(rows.reduce((sum, row) => sum + row.totalScore, 0) / rows.length) : 0,
    averageBreakdown: rows.length > 0 ? {
      structure: Number((rows.reduce((sum, row) => sum + (row.breakdown?.structure ?? 0), 0) / rows.length).toFixed(1)),
      depth: Number((rows.reduce((sum, row) => sum + (row.breakdown?.depth ?? 0), 0) / rows.length).toFixed(1)),
      seo: Number((rows.reduce((sum, row) => sum + (row.breakdown?.seo ?? 0), 0) / rows.length).toFixed(1)),
      geo: Number((rows.reduce((sum, row) => sum + (row.breakdown?.geo ?? 0), 0) / rows.length).toFixed(1)),
      linking: Number((rows.reduce((sum, row) => sum + (row.breakdown?.linking ?? 0), 0) / rows.length).toFixed(1)),
    } : null,
    failedCombinations: failed.map((row) => ({
      words: row.wordTarget,
      template: row.template,
      formatType: row.formatType,
      angle: row.angle,
      score: row.totalScore,
      breakdown: row.breakdown,
      issues: row.issues.slice(0, 5),
    })),
    rows,
  };

  const outPath = path.join(process.cwd(), 'tmp_newsletter_combination_audit.json');
  writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\nAudit complete: ${passed.length}/${rows.length} passed >= ${threshold}`);
  console.log(`Average score: ${summary.averageScore}`);
  if (summary.averageBreakdown) {
    console.log(`Average breakdown: structure ${summary.averageBreakdown.structure}, depth ${summary.averageBreakdown.depth}, seo ${summary.averageBreakdown.seo}, geo ${summary.averageBreakdown.geo}, linking ${summary.averageBreakdown.linking}`);
  }
  console.log(`Report written to ${outPath}`);
  console.log(`Audit company id: ${companyId}`);
  console.log(`Audit run id: ${auditRunId}`);
  console.log(`Published company blogs with slugs: ${publishedCompanyBlogCount}`);
  if (publishedCompanyBlogCount === 0) {
    console.log('Note: internal-link score is currently expected to remain 0 because there are no published company blog targets to inject.');
  }
  if (companyId === 'audit-company') {
    console.log('Note: could not resolve Omnivyra from the database, so linking suggestions may remain expected if no real company posts are available.');
  }
  if (failed.length > 0) {
    console.log('\nLowest-scoring combinations:');
    failed
      .sort((a, b) => a.totalScore - b.totalScore)
      .slice(0, 10)
      .forEach((row) => {
        console.log(`- ${row.wordTarget}+ | ${row.template} | ${row.angle} -> ${row.totalScore}/90`);
        console.log(`  breakdown: structure ${row.breakdown?.structure ?? 0}, depth ${row.breakdown?.depth ?? 0}, seo ${row.breakdown?.seo ?? 0}, geo ${row.breakdown?.geo ?? 0}, linking ${row.breakdown?.linking ?? 0}`);
      });
  }
}

main().catch((error) => {
  console.error('[audit-newsletter-combinations] Failed:', error);
  process.exit(1);
});
