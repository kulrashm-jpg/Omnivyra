import 'dotenv/config';

import { writeFileSync } from 'fs';
import path from 'path';

import { runBlogGeneration, type CompanyContext } from '../lib/blog/runBlogGeneration';
import { getDefaultBlogTemplates, instantiateBlogTemplate, type BlogTemplate } from '../lib/blog/defaultBlogTemplates';
import { calculateContentQualityScore } from '../lib/content/qualityScoringCore';
import type { ContentBlock } from '../lib/content/blockTypes';
import type { AngleType, BlogAngle } from '../lib/blog/blogGenerationEngine';

type AuditRow = {
  wordTarget: number;
  template: string;
  angle: AngleType;
  totalScore: number;
  percentage: number;
  passed: boolean;
  templateUsed: boolean;
  h2Count: number;
  refsCount: number;
  wordCount: number;
  issues: string[];
};

const WORD_TARGETS = [800, 1200, 1600, 2000] as const;
const ANGLES: AngleType[] = ['analytical', 'contrarian', 'strategic'];
const DEFAULT_TOPIC = 'How AI workflow automation is changing B2B operations teams';
const PASS_THRESHOLD = 75;

const DEFAULT_COMPANY_CONTEXT: CompanyContext = {
  companyName: 'Omnivyra',
  industry: 'AI and growth operations',
  audience: 'B2B founders, marketers, and operations leaders',
  brand_voice: 'Clear, practical, analytical, and confident',
  uniqueValue: 'Actionable operating intelligence for growth teams',
  authorityDomains: ['AI workflows', 'SEO', 'GEO', 'content operations'],
};

function parseArg(flag: string): string | null {
  const idx = process.argv.findIndex((arg) => arg === flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function makeAngle(topic: string, angle: AngleType): BlogAngle {
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

async function runOneCombination(
  topic: string,
  wordTarget: number,
  template: BlogTemplate,
  angle: AngleType,
): Promise<AuditRow> {
  const templateBlocks = instantiateBlogTemplate(template, wordTarget);
  const result = await runBlogGeneration({
    company_id: 'audit-company',
    companyContext: DEFAULT_COMPANY_CONTEXT,
    blogTable: 'blogs',
    contentType: 'blog',
    topic,
    intent: 'authority',
    tone: 'expert',
    target_words: wordTarget,
    template_name: template.name,
    template_blocks: templateBlocks,
    selected_angle: makeAngle(topic, angle),
    fetchAngleData: async () => null,
    fetchSeriesData: async () => [],
  });

  if (result.needs_clarification || !('mode' in result) || result.mode !== 'full') {
    return {
      wordTarget,
      template: template.name,
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
  const blocks = output.content_blocks as ContentBlock[];
  const score = calculateContentQualityScore(blocks, {
    title: output.title,
    excerpt: output.excerpt,
    seo_meta_title: output.seo_meta_title,
    seo_meta_description: output.seo_meta_description,
    tags: output.tags,
    target_word_count: wordTarget,
    content_type: 'blog',
  });

  return {
    wordTarget,
    template: template.name,
    angle,
    totalScore: score.total,
    percentage: Math.round((score.total / 100) * 100),
    passed: score.total >= PASS_THRESHOLD,
    templateUsed: !!result.template_used,
    h2Count: score.meta.h2Count,
    refsCount: score.meta.refsCount,
    wordCount: score.meta.wordCount,
    issues: score.issues.map((issue) => issue.message),
  };
}

async function main() {
  const topic = parseArg('--topic') || DEFAULT_TOPIC;
  const threshold = Number(parseArg('--threshold') || PASS_THRESHOLD);
  const selectedTemplate = (parseArg('--template') || '').trim().toLowerCase();
  const selectedWordTarget = Number(parseArg('--words') || 0);

  const allTemplates = getDefaultBlogTemplates();
  const templates = selectedTemplate
    ? allTemplates.filter((template) => template.name.toLowerCase() === selectedTemplate)
    : allTemplates;
  const wordTargets = selectedWordTarget && WORD_TARGETS.includes(selectedWordTarget as any)
    ? [selectedWordTarget as (typeof WORD_TARGETS)[number]]
    : [...WORD_TARGETS];

  if (templates.length === 0) {
    throw new Error(`No blog template found for "${selectedTemplate}"`);
  }

  const rows: AuditRow[] = [];
  for (const wordTarget of wordTargets) {
    for (const template of templates) {
      for (const angle of ANGLES) {
        // Keep the harness deterministic and easy to read in logs.
         
        console.log(`Running ${wordTarget}+ | ${template.name} | ${angle}`);
        const row = await runOneCombination(topic, wordTarget, template, angle);
        row.passed = row.totalScore >= threshold;
        rows.push(row);
      }
    }
  }

  const passed = rows.filter((row) => row.passed);
  const failed = rows.filter((row) => !row.passed);
  const summary = {
    topic,
    threshold,
    total: rows.length,
    passed: passed.length,
    failed: failed.length,
    averageScore: rows.length > 0 ? Math.round(rows.reduce((sum, row) => sum + row.totalScore, 0) / rows.length) : 0,
    failedCombinations: failed.map((row) => ({
      words: row.wordTarget,
      template: row.template,
      angle: row.angle,
      score: row.totalScore,
      issues: row.issues.slice(0, 5),
    })),
    rows,
  };

  const outPath = path.join(process.cwd(), 'tmp_blog_combination_audit.json');
  writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

   
  console.log(`\nAudit complete: ${passed.length}/${rows.length} passed >= ${threshold}`);
   
  console.log(`Average score: ${summary.averageScore}`);
   
  console.log(`Report written to ${outPath}`);
  if (failed.length > 0) {
     
    console.log('\nLowest-scoring combinations:');
    failed
      .sort((a, b) => a.totalScore - b.totalScore)
      .slice(0, 10)
      .forEach((row) => {
         
        console.log(`- ${row.wordTarget}+ | ${row.template} | ${row.angle} -> ${row.totalScore}/100`);
      });
  }
}

main().catch((error) => {
   
  console.error('[audit-blog-combinations] Failed:', error);
  process.exit(1);
});
