import { evaluatePhase1QualityGates } from '../phase1QualityGates';
import { validateFinalBlogOutcome } from '../finalBlogOutcomeValidator';
import type { OrganizationPerspective } from '../organizationPerspectiveEngine';

const perspective: OrganizationPerspective = {
  companyViewpoint: 'automation accelerates creative throughput for modern teams',
  marketObservation: 'distributed creative autonomy reshapes governance expectations',
  strategicRecommendation: 'prioritize compounding data feedback loops over isolated campaigns',
  tradeoffAnalysis: 'centralized governance versus distributed creative autonomy',
  proprietaryInsight: 'compounding data feedback loops outperform isolated campaigns',
  primaryAudience: 'growth leaders',
};

// A genuinely strong, defect-free article body used as the "clean" baseline.
// This body is independently verified to pass validateFinalBlogOutcome (score
// 91) so the integration test isolates GATE behavior, not base-score noise.
const cleanBody = [
  '<h2>The Strategic Case</h2>',
  '<p>A chief marketing officer recently framed her quarter as a contest between speed and judgement: the team could ship faster than ever, yet every shortcut quietly eroded what made the brand recognizable. Leaders must decide where automation accelerates creative throughput and where it simply manufactures noise.</p>',
  '<p>That tension defines the modern growth agenda. When a model drafts a hundred variations before lunch, the scarce resource stops being production and becomes the editorial judgement about which ideas deserve to exist. Executives should prioritize that judgement and measure it against revenue, not volume.</p>',
  '<p>Centralized governance and distributed creative autonomy pull in opposite directions, and the owner must sequence that tradeoff deliberately. Push too hard toward control and experiments die; lean too far toward freedom and the brand fragments into incoherent campaigns.</p>',
  '<h2>The Data Loop</h2>',
  '<p>Companies pulling ahead treat measurement as a weekly habit rather than a quarterly ritual. They assign a clear owner to every channel, review the budget against outcomes, and let compounding feedback loops outperform the isolated campaigns rivals keep chasing.</p>',
  '<p>What reads as luck is usually disciplined sequencing. A small bet validates an angle, the angle informs the next budget decision, and the operating model tightens around whatever the evidence actually rewards. Risk concentrates in the handoffs nobody owns.</p>',
  '<p>So leaders should instrument the gaps first. When governance is light enough to move but explicit about who decides, automation accelerates the work without racing past the moment a human should have asked whether the throughput pointed at anything worthwhile.</p>',
  '<h2>Operating Model</h2>',
  '<p>Designing for this reality means choosing defaults on purpose. Growth leaders prioritize the next concrete step, name who is accountable, and measure how a governance choice ripples into the autonomy their creative teams feel day to day.</p>',
  '<p>Generic automation is the quiet failure mode. Copying a competitor erodes the differentiation that justified the investment, so the discipline is to weigh proprietary insight against the cost of building it and decide where scarce resource allocation belongs.</p>',
  '<p>Executives who get this right revisit the operating model on a cadence, prune the roadmap, and choose tradeoffs that let evidence compound faster than rivals can imitate. The resulting advantage is structural rather than accidental.</p>',
  '<h2>Execution Cadence</h2>',
  '<p>In practice the rhythm is unglamorous: watch throughput against quality, keep governance proportionate, give owners real authority, and surface risk early enough that strategy survives contact with the production line.</p>',
  '<p>Teams that sustain this decide their cadence on purpose, compare results honestly, start the smallest viable test, and stop initiatives that fail to feed the loops driving differentiation. Consistency, not heroics, is what ultimately compounds.</p>',
].join('\n');

const out = (title: string, content_html: string, excerpt = 'A strategic look at modern growth.'): any => ({
  title, excerpt, content_html, tags: [], seo_meta_title: title, seo_meta_description: excerpt, key_insights: [],
});

describe('Phase 1 quality gates — unit detection', () => {
  describe('Publishing Readiness Gate', () => {
    it('fires on a leaked purpose-statement instruction (cap 70)', () => {
      const html = `<h2>Intro</h2><p>The purpose of this section is to introduce the reader to the topic.</p>`;
      const r = evaluatePhase1QualityGates({ title: 'Growth Strategy', contentHtml: html });
      expect(r.triggered.some((t) => t.gate === 'publishing_readiness')).toBe(true);
      expect(r.scoreCap).toBe(70);
    });
    it('fires on a "this section should" directive', () => {
      const html = `<p>This section should help the reader understand attribution.</p>`;
      const r = evaluatePhase1QualityGates({ title: 'Attribution', contentHtml: html });
      expect(r.triggered.some((t) => t.detector === 'section-directive')).toBe(true);
    });
    it('fires on a "must serve a separate reader job" planner note', () => {
      const html = `<p>This must serve a distinct reader intent from the previous part.</p>`;
      const r = evaluatePhase1QualityGates({ title: 'X', contentHtml: html });
      expect(r.triggered.some((t) => t.gate === 'publishing_readiness')).toBe(true);
    });
    it('does NOT fire on clean editorial prose', () => {
      const r = evaluatePhase1QualityGates({ title: 'The Strategic Case for Automation', contentHtml: cleanBody });
      expect(r.triggered.some((t) => t.gate === 'publishing_readiness')).toBe(false);
    });
  });

  describe('Placeholder Gate', () => {
    it('fires on {{mustache}} (cap 60)', () => {
      const r = evaluatePhase1QualityGates({ title: 'X', contentHtml: '<p>Welcome to {{company_name}}.</p>' });
      expect(r.triggered.some((t) => t.gate === 'placeholder')).toBe(true);
      expect(r.scoreCap).toBe(60);
    });
    it('fires on [INSERT STAT] bracket directive', () => {
      const r = evaluatePhase1QualityGates({ title: 'X', contentHtml: '<p>Revenue grew [INSERT STAT] last year.</p>' });
      expect(r.triggered.some((t) => t.detector === 'bracket-directive')).toBe(true);
    });
    it('fires on bare TBD / FIXME markers', () => {
      expect(evaluatePhase1QualityGates({ title: 'X', contentHtml: '<p>Pricing details TBD.</p>' }).triggered.length).toBeGreaterThan(0);
      expect(evaluatePhase1QualityGates({ title: 'X', contentHtml: '<p>FIXME before publish.</p>' }).triggered.length).toBeGreaterThan(0);
    });
    it('does NOT fire on clean prose with brackets-free content', () => {
      expect(evaluatePhase1QualityGates({ title: 'X', contentHtml: cleanBody }).triggered.some((t) => t.gate === 'placeholder')).toBe(false);
    });
  });

  describe('Framework Delivery Gate', () => {
    it('fires when a framework is claimed but not delivered (cap 70 + framework subscore cap)', () => {
      const html = `<h2>Our Approach</h2><p>We developed a proprietary framework that helps teams grow. It is powerful and effective and worth adopting.</p>`;
      const r = evaluatePhase1QualityGates({ title: 'Growth', contentHtml: html });
      expect(r.triggered.some((t) => t.gate === 'framework_delivery')).toBe(true);
      expect(r.frameworkScoreCap).toBe(50);
    });
    it('does NOT fire when the framework is delivered via enumerated steps', () => {
      const html = `<h2>Our Framework</h2><p>We use the Growth Loop framework.</p><ol><li>Acquire users through targeted channels.</li><li>Activate them with a clear first value.</li><li>Retain them with compounding habits.</li></ol>`;
      const r = evaluatePhase1QualityGates({ title: 'Growth', contentHtml: html });
      expect(r.triggered.some((t) => t.gate === 'framework_delivery')).toBe(false);
      expect(r.frameworkScoreCap).toBeNull();
    });
    it('does NOT fire on incidental "operating model" / "business model" usage', () => {
      const html = `<p>The company changed its operating model and revisited its business model after a downturn.</p>`;
      const r = evaluatePhase1QualityGates({ title: 'Strategy', contentHtml: html });
      expect(r.triggered.some((t) => t.gate === 'framework_delivery')).toBe(false);
    });
  });

  describe('Promise Fulfillment Gate', () => {
    it('fires when the title promises a checklist the body lacks (cap 65)', () => {
      const html = `<p>Here are some thoughts about onboarding without any concrete list.</p>`;
      const r = evaluatePhase1QualityGates({ title: 'The Ultimate Onboarding Checklist', contentHtml: html });
      expect(r.triggered.some((t) => t.gate === 'promise_fulfillment')).toBe(true);
      expect(r.scoreCap).toBe(65);
    });
    it('does NOT fire when the checklist is delivered as a list', () => {
      const html = `<ul><li>Send the welcome email.</li><li>Schedule the kickoff.</li><li>Share the success plan.</li></ul>`;
      const r = evaluatePhase1QualityGates({ title: 'The Ultimate Onboarding Checklist', contentHtml: html });
      expect(r.triggered.some((t) => t.gate === 'promise_fulfillment')).toBe(false);
    });
    it('fires on an unfulfilled listicle count (title "7 steps", body has 1)', () => {
      const html = `<p>Growth is hard.</p><ul><li>Just one idea here.</li></ul>`;
      const r = evaluatePhase1QualityGates({ title: '7 Steps to Predictable Growth', contentHtml: html });
      expect(r.triggered.some((t) => t.detector === 'title-promise:listicle')).toBe(true);
    });
  });

  it('takes the MINIMUM cap when multiple gates fire', () => {
    const html = `<p>The purpose of this section is to explain. Pricing TBD.</p>`;
    const r = evaluatePhase1QualityGates({ title: 'X', contentHtml: html });
    expect(r.scoreCap).toBe(60); // placeholder(60) < publishing(70)
  });
});

describe('Phase 1 hardening — boilerplate must not satisfy delivery/fulfillment', () => {
  const fw = (g: ReturnType<typeof evaluatePhase1QualityGates>) => g.triggered.some((t) => t.gate === 'framework_delivery');
  const promise = (g: ReturnType<typeof evaluatePhase1QualityGates>) => g.triggered.some((t) => t.gate === 'promise_fulfillment');

  it('A. framework claim + references list only → FIRES (references is boilerplate)', () => {
    const html = `<h2>Our Method</h2><p>We developed a proprietary framework for durable growth.</p>`
      + `<h2>References</h2><ul><li>Source A</li><li>Source B</li><li>Source C</li></ul>`;
    expect(fw(evaluatePhase1QualityGates({ title: 'Growth', contentHtml: html }))).toBe(true);
  });

  it('B. framework claim + actual co-located framework → does NOT fire', () => {
    const html = `<h2>The Growth Framework</h2><p>Our framework has three parts.</p>`
      + `<ol><li>Acquire deliberately.</li><li>Activate quickly.</li><li>Retain with habits.</li></ol>`
      + `<h2>References</h2><ul><li>Source A</li><li>Source B</li><li>Source C</li></ul>`;
    expect(fw(evaluatePhase1QualityGates({ title: 'Growth', contentHtml: html }))).toBe(false);
  });

  it('C. checklist title + FAQ list → FIRES (FAQ is boilerplate)', () => {
    const html = `<h2>FAQ</h2><ul><li>What is onboarding?</li><li>How long?</li><li>Who owns it?</li></ul>`;
    expect(promise(evaluatePhase1QualityGates({ title: 'The Ultimate Onboarding Checklist', contentHtml: html }))).toBe(true);
  });

  it('D. checklist title + actual checklist → does NOT fire', () => {
    const html = `<h2>Steps</h2><ul><li>Send the welcome email.</li><li>Schedule the kickoff.</li><li>Share the success plan.</li></ul>`;
    expect(promise(evaluatePhase1QualityGates({ title: 'The Ultimate Onboarding Checklist', contentHtml: html }))).toBe(false);
  });

  it('E. roadmap title + related reading list → FIRES (related reading is boilerplate)', () => {
    const html = `<h2>Related Reading</h2><ul><li>Article A</li><li>Article B</li><li>Article C</li></ul>`;
    expect(promise(evaluatePhase1QualityGates({ title: '2026 Product Roadmap', contentHtml: html }))).toBe(true);
  });

  it('F. roadmap title + actual roadmap → does NOT fire', () => {
    const html = `<h2>The Plan</h2><p>Phase 1: discovery and validation. Phase 2: build the core. Phase 3: launch and scale.</p>`;
    expect(promise(evaluatePhase1QualityGates({ title: '2026 Product Roadmap', contentHtml: html }))).toBe(false);
  });

  it('System #2 parity: data-omni-boilerplate lists do not count as delivery', () => {
    const html = `<h2>Our Method</h2><p>We use a proprietary methodology for growth.</p>`
      + `<ul data-omni-boilerplate="key_insights"><li>Insight one.</li><li>Insight two.</li><li>Insight three.</li></ul>`
      + `<ul data-omni-boilerplate="references"><li>Source A</li><li>Source B</li><li>Source C</li></ul>`;
    expect(fw(evaluatePhase1QualityGates({ title: 'Growth', contentHtml: html }))).toBe(true);
  });
});

describe('Phase 1 gates — integration with validateFinalBlogOutcome', () => {
  it('caps score and fails a strong-but-defective article (placeholder leak)', () => {
    const defective = out('The Strategic Case for Automation', cleanBody + '<p>Final number: {{revenue}}.</p>');
    const r = validateFinalBlogOutcome({ output: defective, organizationPerspective: perspective });
    expect(r.score).toBeLessThanOrEqual(60);
    expect(r.passed).toBe(false);
    expect(r.gates.some((g) => g.gate === 'placeholder')).toBe(true);
  });

  it('leaves a clean strong article unchanged (no gate, passes)', () => {
    const clean = out('The Strategic Case for Automation', cleanBody);
    const r = validateFinalBlogOutcome({ output: clean, organizationPerspective: perspective });
    expect(r.gates.length).toBe(0);
    expect(r.frameworkScoreCap).toBeNull();
    expect(r.passed).toBe(true);
  });
});
