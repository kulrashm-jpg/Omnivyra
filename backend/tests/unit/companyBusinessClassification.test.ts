import { classifyCompanyBusiness } from '../../services/companyProfile/businessClassification';
import type { CompanyProfile } from '../../services/companyProfile/types';

describe('company business classification', () => {
  const classify = (profile: Partial<CompanyProfile>) =>
    classifyCompanyBusiness({
      name: 'Test Company',
      company_id: `test-${String(profile.name || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      ...profile,
    } as CompanyProfile);

  it('classifies multi-domain AI assistants as function-first instead of vertical-first', () => {
    const profile: CompanyProfile = {
      company_id: 'drishiq',
      name: 'Drishiq',
      industry: 'Information Services, Consultation, Health, Productivity',
      category: 'AI clarity tool',
      products_services: 'Multilingual clarity assistant, personalized guidance, voice and text support, decision-making support',
      target_audience: 'Individuals seeking clarity, professionals looking for direction, students making career choices',
      goals: 'Help users find direction, enhance mental clarity, support decision-making',
      unique_value: 'AI-powered clarity platform that provides personalized, culturally aware guidance',
      content_themes: 'Clarity, Personal Growth, Decision Making, Mental Health, Self reflection',
    } as CompanyProfile;

    const result = classifyCompanyBusiness(profile);

    expect(result.business_classification.level_1).toBe('product_company');
    expect(result.business_classification.level_2).toBe('ai_product');
    expect(result.industry).toEqual(['Decision Support', 'Personal Development']);
    expect(result.business_classification.level_3).toEqual(expect.arrayContaining(['Decision Support', 'Personal Development']));
    expect(result.category).toBe('AI tool for structured thinking and clearer life and career decisions');
    expect(result.industry).not.toContain('Health Technology');
  });

  it('classifies SaaS marketing tools as marketing technology', () => {
    const result = classify({
      name: 'CampaignOps',
      category: 'Marketing automation SaaS',
      products_services: 'Cloud platform to automate campaigns, manage CRM segments, email marketing, lead nurturing, and SEO content workflows',
      target_audience: 'B2B marketers, growth teams, and sales teams',
      goals: 'Improve conversion, demand generation, pipeline visibility, and campaign performance',
    });

    expect(result.business_classification.level_1).toBe('product_company');
    expect(result.business_classification.level_2).toBe('saas_product');
    expect(result.industry).toEqual(['Marketing Technology']);
    expect(result.business_classification.level_3).toEqual(expect.arrayContaining(['Marketing Technology']));
  });

  it('classifies AI writing tools as content creation', () => {
    const result = classify({
      name: 'DraftPilot',
      category: 'AI writing tool',
      products_services: 'AI writer that generates blog posts, articles, captions, landing page copy, and ad copy',
      target_audience: 'Creators, writers, and content marketers',
      goals: 'Help teams overcome writer’s block, increase publishing velocity, and improve creative output',
    });

    expect(result.business_classification.level_1).toBe('product_company');
    expect(result.business_classification.level_2).toBe('ai_product');
    expect(result.industry).toEqual(['Content Creation']);
    expect(result.business_classification.level_3).toEqual(expect.arrayContaining(['Content Creation']));
  });

  it('classifies narrow mental health apps as mental wellness', () => {
    const result = classify({
      name: 'CalmCare',
      category: 'Mental health mobile app',
      products_services: 'Mobile therapy app with CBT exercises, mood tracking, guided emotional support, and therapist-approved programs',
      target_audience: 'Individuals seeking support for anxiety, stress, and emotional wellbeing',
      goals: 'Help users manage anxiety, reduce stress, and build healthier mental health routines',
    });

    expect(result.business_classification.level_1).toBe('product_company');
    expect(result.business_classification.level_2).toBe('mobile_app');
    expect(result.industry).toEqual(['Mental Wellness']);
    expect(result.business_classification.level_3).toEqual(expect.arrayContaining(['Mental Wellness']));
  });

  it('classifies manufacturing companies as manufacturing and industrial', () => {
    const result = classify({
      name: 'ForgeLine Components',
      industry: 'Industrial manufacturing',
      category: 'Manufacturer of industrial equipment',
      products_services: 'Manufactures precision pumps, valves, industrial machinery components, and fabricated parts for production plants',
      target_audience: 'Industrial operators, plant managers, and maintenance teams',
      goals: 'Improve equipment reliability, reduce downtime, and support production line throughput',
    });

    expect(result.business_classification.level_1).toBe('manufacturer');
    expect(result.business_classification.level_2).toBe('manufacturer');
    expect(result.industry).toEqual(['Manufacturing', 'Industrial']);
    expect(result.business_classification.level_3).toEqual(expect.arrayContaining(['Manufacturing', 'Industrial']));
  });

  it('classifies marketplaces as ecommerce and marketplace', () => {
    const result = classify({
      name: 'MakerMarket',
      category: 'Two-sided ecommerce marketplace',
      products_services: 'Marketplace connecting independent sellers and buyers through product listings, checkout, vendor storefronts, and transactions',
      target_audience: 'Buyers, sellers, and vendors',
      goals: 'Help buyers discover trusted products and help sellers grow online sales channels',
    });

    expect(result.business_classification.level_1).toBe('marketplace');
    expect(result.business_classification.level_2).toBe('b2c_marketplace');
    expect(result.industry).toEqual(['E-commerce', 'Marketplace']);
    expect(result.business_classification.level_3).toEqual(expect.arrayContaining(['E-commerce', 'Marketplace']));
  });

  it('keeps classification stable across repeated runs with noisy website-like content', () => {
    const noisyProfile: Partial<CompanyProfile> = {
      company_id: 'stable-noisy-ai-assistant',
      name: 'NorthStar AI',
      category: 'AI clarity assistant',
      products_services: [
        'AI assistant for decision support, personal guidance, planning, and reflective prompts.',
        'Testimonials: This changed my life. Read more. Subscribe to our newsletter.',
        'Navigation footer privacy policy terms cookie settings recent posts.',
      ].join('\n'),
      target_audience: 'Students, professionals, founders, and individuals navigating career, life, and business choices',
      goals: 'Help users make clearer decisions, understand tradeoffs, find direction, and build personal momentum',
      content_themes: 'Blog article SEO filler: top 10 productivity hacks, testimonials, related posts, footer links',
      core_problem_statement: 'People struggle with uncertainty across career, personal, and business decisions',
      desired_transformation: 'Move from confusion to clear next steps and confident decision-making',
    };

    const first = classify(noisyProfile);
    const second = classify(noisyProfile);
    const third = classify(noisyProfile);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.industry).toEqual(['Decision Support', 'Personal Development']);
  });

  it('classifies generic SaaS by function instead of generic technology', () => {
    const result = classify({
      name: 'OpsFlow',
      category: 'SaaS platform',
      products_services: 'Workflow automation platform with task orchestration, approvals, scheduling, and dashboards',
      target_audience: 'Business teams and operations managers',
      goals: 'Reduce manual work, improve process efficiency, and remove operational bottlenecks',
    });

    expect(result.business_classification.level_1).toBe('product_company');
    expect(result.business_classification.level_2).toBe('saas_product');
    expect(result.industry).toEqual(['Workflow Automation']);
    expect(result.industry).not.toContain('technology');
  });

  it('classifies agencies as services companies even when they mention platforms', () => {
    const result = classify({
      name: 'BrightPath Agency',
      category: 'Marketing agency',
      products_services: 'Agency services for SEO, campaign strategy, content marketing, and implementation using client analytics platforms',
      target_audience: 'B2B marketers and founders',
      goals: 'Improve acquisition, brand visibility, and campaign performance through done-for-you execution',
    });

    expect(result.business_classification.level_1).toBe('services_company');
    expect(result.business_classification.level_2).toBe('marketing_agency');
    expect(result.industry).toEqual(['Marketing Technology']);
  });
});
