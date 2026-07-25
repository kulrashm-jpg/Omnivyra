/**
 * Capability-vs-identity guard for the entity archetype classifier.
 *
 * Regression lock for the Embro Sales incident: a B2B "customer engagement software for
 * retention and lifecycle growth" was misclassified as an audience-led / hybrid entity because
 * its marketing copy contains capability vocabulary ("newsletter", "community", "engagement",
 * "subscribers"). That misclassification then drove a hardcoded roster of creator-economy
 * personalities (Justin Welsh, Seth Godin, Lenny's Newsletter, …) to surface as "competitors".
 *
 * These tests pin the fix at the root: capability vocabulary is not business identity. Software
 * that SENDS newsletters / powers community is not itself a newsletter or a community business,
 * so it must classify as a business-first product — never audience-led, never influential.
 */
import {
  inferEntityArchetype,
  isArchetypeInfluential,
  isAudienceLedArchetype,
  isBusinessFirstOnlyArchetype,
} from '../../services/companyProfile/entityArchetype';

const AUDIENCE_LED = new Set([
  'PERSONAL_BRAND',
  'CREATOR_EDUCATOR',
  'COMMUNITY_LED',
  'THOUGHT_LEADER',
  'MEDIA_NEWSLETTER',
  'HYBRID_ENTITY',
]);

function buildProfile(overrides: Record<string, unknown>) {
  return {
    company_id: 'guard-fixture',
    name: 'Fixture Co',
    website_url: 'https://fixture.example',
    industry: null,
    category: null,
    products_services: null,
    target_audience: null,
    unique_value: null,
    brand_positioning: null,
    content_themes: null,
    blog_url: null,
    geography: 'Global',
    social_profiles: [],
    report_settings: {},
    ...overrides,
  } as any;
}

describe('entity archetype — capability vs identity', () => {
  it('classifies engagement/retention/lifecycle SaaS as business-first, NOT audience-led (Embro class)', () => {
    const profile = buildProfile({
      name: 'Embro Sales',
      category: 'customer engagement software',
      products_services:
        'customer engagement software platform for retention and lifecycle growth; helps you engage your audience, build community, and send newsletters and lifecycle marketing campaigns to your customers',
      target_audience: 'B2B marketing and customer success teams',
      brand_positioning: 'engagement platform that helps businesses grow retention across the customer lifecycle',
      unique_value: 'automation, analytics, and lifecycle marketing for your customers',
    });

    const archetype = inferEntityArchetype({ profile, evidence: [] });

    // Must not be an audience-led / hybrid identity.
    expect(AUDIENCE_LED.has(archetype.primary_archetype)).toBe(false);
    expect(archetype.secondary_archetypes.some((value) => AUDIENCE_LED.has(value))).toBe(false);
    // The load-bearing guarantee: never audience-led. This is what gated the (now-removed)
    // archetype peer injection and still gates audience-led narrative synthesis. A confident
    // product classification may be "influential", but a business-first-only identity never
    // produces creator/newsletter peers.
    expect(isAudienceLedArchetype(archetype)).toBe(false);
    if (isArchetypeInfluential(archetype)) {
      expect(isBusinessFirstOnlyArchetype(archetype)).toBe(true);
    }
  });

  it('does NOT strip capability detection — a genuine newsletter business stays MEDIA_NEWSLETTER', () => {
    const profile = buildProfile({
      name: 'The Daily Signal',
      category: 'newsletter and publication',
      products_services: 'our weekly newsletter and publication; we publish deeply researched essays',
      target_audience: 'subscribers and readers',
      brand_positioning: 'independent editorial publication — subscribe to our newsletter, written by our editors',
      unique_value: 'trusted weekly editorial for our readers',
      content_themes: 'editorial, essays, journalism',
    });

    const archetype = inferEntityArchetype({ profile, evidence: [] });

    // First-person publisher identity → audience-led identity is correctly retained.
    const values = [archetype.primary_archetype, ...archetype.secondary_archetypes];
    expect(values).toContain('MEDIA_NEWSLETTER');
    expect(isBusinessFirstOnlyArchetype(archetype)).toBe(false);
  });

  it('does not flip a pure analytics platform into a media company', () => {
    const profile = buildProfile({
      name: 'Metricly',
      category: 'analytics software',
      products_services: 'analytics platform and dashboard software with an API for product teams',
      target_audience: 'product and data teams',
      brand_positioning: 'the analytics platform for your product metrics',
      unique_value: 'dashboards, API access, and automation',
    });

    const archetype = inferEntityArchetype({ profile, evidence: [] });

    expect(AUDIENCE_LED.has(archetype.primary_archetype)).toBe(false);
    expect(isAudienceLedArchetype(archetype)).toBe(false);
  });
});
