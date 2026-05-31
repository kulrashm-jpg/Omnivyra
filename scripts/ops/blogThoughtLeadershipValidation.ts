import { writeFileSync } from 'fs';
import { runUnifiedLongFormGeneration } from '../../lib/content/unifiedLongFormEngine';
import type { CompanyContext } from '../../lib/blog/blogRunnerTypes';
import { ThoughtLeadershipQualityGateError } from '../../backend/services/longForm/thoughtLeadershipQualityGate';

const topics = [
  'why executive teams outgrow generic content calendars',
  'how founder-led companies should turn market insight into demand',
  'the operating model for strategic content governance',
  'why AI content fails without a company point of view',
  'how CMOs should evaluate content quality beyond traffic',
  'the maturity model for thought leadership operations',
  'how strategic buyers judge expertise before a sales call',
  'why content teams need decision frameworks, not topic lists',
  'how category narratives become measurable pipeline assets',
  'the executive tradeoffs behind publishing less but saying more',
  'how audience intelligence should reshape long-form planning',
  'why rebrandable articles weaken commercial trust',
  'the diagnostic model for company-authored authority',
  'how leadership teams should use blogs as strategic proof',
  'why generic SEO briefs produce interchangeable expertise',
  'the evaluation framework for executive-level content',
  'how market observations become proprietary editorial systems',
  'why strategic differentiation must appear in every section',
  'the operating cadence for content that compounds authority',
  'how directors should separate useful education from strategic advice',
  'why tradeoff analysis belongs in every serious blog',
  'the buyer-readiness model for long-form content',
  'how company context prevents AI-generated blandness',
  'why frameworks beat explanation in executive content',
  'the leadership scorecard for organization-first publishing',
];

const companyContext: CompanyContext = {
  companyName: 'Omnivyra',
  industry: 'marketing intelligence and content strategy',
  audience: 'Founders, CMOs, VPs, Directors, Department Heads, and strategic buyers',
  brand_voice: 'analytical, direct, executive, and operationally specific',
  uniqueValue: 'Omnivyra connects company strategy, market intelligence, and content execution into one governed operating system.',
  competitiveAdvantages: 'The platform combines governance metadata, opportunity intelligence, strategic recommendation flows, and long-form quality controls.',
  coreProblemStatement: 'Leadership teams publish educational content that sounds competent but fails to express a differentiated company belief.',
  problemImpact: 'Generic content wastes executive attention, weakens buyer trust, and makes the company easier to compare on features or price.',
  desiredTransformation: 'Turn every long-form asset into evidence of how the company thinks, decides, and helps buyers make better strategic choices.',
  transformationMechanism: 'Use organization perspective, rebrand resistance, executive relevance, and framework enforcement before publication.',
  keyMessages: 'Organization-first content should prove judgment, not just explain concepts.',
  growthPriorities: 'Increase strategic authority, strengthen buyer trust, and improve content-to-pipeline conversion quality.',
};

const VALIDATION_COMPANY_ID = '00000000-0000-4000-8000-000000000025';

function row(values: Array<string | number | boolean>): string {
  return `| ${values.map((value) => String(value).replace(/\|/g, '/')).join(' | ')} |`;
}

async function main(): Promise<void> {
  const results: string[] = [
    '# Blog Thought Leadership Validation',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    row(['topic', 'audience', 'POV score', 'strategic score', 'rebrand score', 'framework presence', 'genericity score', 'editorial body', 'duplication', 'status']),
    row(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---']),
  ];
  writeFileSync('BLOG_THOUGHT_LEADERSHIP_VALIDATION.md', `${results.join('\n')}\n`);

  const requestedLimit = Number.parseInt(process.env.BLOG_TL_SAMPLE_SIZE ?? String(topics.length), 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, topics.length) : topics.length;

  for (const topic of topics.slice(0, limit)) {
    try {
      console.info(`[blogThoughtLeadershipValidation] generating: ${topic}`);
      const result = await runUnifiedLongFormGeneration({
        company_id: VALIDATION_COMPANY_ID,
        contentType: 'blog',
        mode: 'full',
        topic,
        intent: 'authority',
        companyContext,
        targetWordCount: 900,
        answers: {
          target_word_count: '900',
          audience: companyContext.audience ?? '',
        },
        strictPlannedEngine: true,
      });

      if (result.needs_clarification === false && result.mode === 'full' && result.thought_leadership_quality) {
        const quality = result.thought_leadership_quality;
        results.push(row([
          topic,
          quality.organizationPerspective.primaryAudience,
          quality.companyPovScore,
          quality.strategicValueScore,
          quality.rebrandResistanceScore,
          quality.frameworkPresence.passed ? 'PASS' : 'FAIL',
          quality.genericityScore,
          quality.editorialBodyScore,
          quality.duplicationScore,
          quality.passed ? 'PASS' : `FAIL: ${quality.failures.join('; ')}`,
        ]));
      } else {
        results.push(row([topic, 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'FAIL: no full result']));
      }
    } catch (error) {
      if (error instanceof ThoughtLeadershipQualityGateError) {
        const quality = error.report;
        results.push(row([
          topic,
          quality.organizationPerspective.primaryAudience,
          quality.companyPovScore,
          quality.strategicValueScore,
          quality.rebrandResistanceScore,
          quality.frameworkPresence.passed ? 'PASS' : 'FAIL',
          quality.genericityScore,
          quality.editorialBodyScore,
          quality.duplicationScore,
          `FAIL: ${quality.failures.join('; ')}`,
        ]));
      } else {
        results.push(row([
          topic,
          'n/a',
          'n/a',
          'n/a',
          'n/a',
          'n/a',
          'n/a',
          'n/a',
          'n/a',
          `FAIL: ${error instanceof Error ? error.message : String(error)}`,
        ]));
      }
    }
    writeFileSync('BLOG_THOUGHT_LEADERSHIP_VALIDATION.md', `${results.join('\n')}\n`);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
