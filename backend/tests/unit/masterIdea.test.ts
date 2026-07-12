/**
 * CAMPAIGN-IMPL-004 — Master-Idea identity, variants, semantic fingerprints.
 */
import {
  deriveMasterIdeaBundle,
  readMasterIdeaBundle,
  fingerprint,
  normalizeForFingerprint,
  type MasterIdeaInput,
} from '../../../lib/shared/campaign/masterIdea';

const base: MasterIdeaInput = {
  campaignId: 'camp-1',
  weekNumber: 1,
  ideaKey: 'w1::t3',
  theme: 'Onboarding wins',
  narrative: 'Customer success stories',
  audience: 'RevOps leaders',
  intent: 'Show fast time-to-value',
  buyerJourneyStage: 'Education',
  ctaStrategy: 'Book a demo',
  coreMessage: 'Teams reach value in days, not months',
  topicTitle: 'How teams hit value in a week',
};

describe('Master Idea identity', () => {
  it('is deterministic — same inputs → same id + fingerprints', () => {
    const a = deriveMasterIdeaBundle(base);
    const b = deriveMasterIdeaBundle({ ...base });
    expect(a.master_idea.id).toBe(b.master_idea.id);
    expect(a.variant.variant_id).toBe(b.variant.variant_id);
    expect(a.fingerprint).toEqual(b.fingerprint);
    expect(a.master_idea.id).toMatch(/^mi_[0-9a-f]{8}$/);
    expect(a.variant.variant_id).toMatch(/^cv_[0-9a-f]{8}$/);
  });

  it('every format variant of one idea SHARES the master_idea_id but gets its OWN variant_id', () => {
    const blog = deriveMasterIdeaBundle({ ...base, contentType: 'blog', topicTitle: 'Deep dive: value in a week' });
    const carousel = deriveMasterIdeaBundle({ ...base, contentType: 'carousel', topicTitle: 'Value in a week — 5 slides' });
    const post = deriveMasterIdeaBundle({ ...base, contentType: 'post', topicTitle: 'Value in a week (hook)' });
    // Same idea → same master id
    expect(blog.master_idea.id).toBe(carousel.master_idea.id);
    expect(blog.master_idea.id).toBe(post.master_idea.id);
    // Distinct assets → distinct variant ids + variant types
    const ids = new Set([blog.variant.variant_id, carousel.variant.variant_id, post.variant.variant_id]);
    expect(ids.size).toBe(3);
    expect(blog.variant.variant_type).toBe('blog');
    expect(carousel.variant.variant_type).toBe('carousel');
  });

  it('variants intentionally differ (differentiator is format-specific, not a paraphrase)', () => {
    const carousel = deriveMasterIdeaBundle({ ...base, contentType: 'carousel' });
    const thread = deriveMasterIdeaBundle({ ...base, contentType: 'thread' });
    expect(carousel.variant.differentiator).not.toBe(thread.variant.differentiator);
    expect(carousel.variant.differentiator.toLowerCase()).toContain('slide');
    expect(thread.variant.differentiator.toLowerCase()).toMatch(/thread|segment|unroll/);
  });

  it('carries the canonical idea fields', () => {
    const b = deriveMasterIdeaBundle(base);
    expect(b.master_idea).toMatchObject({
      theme: 'Onboarding wins',
      audience: 'RevOps leaders',
      buyer_journey_stage: 'education',
      cta_strategy: 'Book a demo',
      core_message: 'Teams reach value in days, not months',
    });
  });

  it('different ideas produce different master ids', () => {
    const other = deriveMasterIdeaBundle({ ...base, ideaKey: 'w1::t9', coreMessage: 'A completely different message' });
    expect(other.master_idea.id).not.toBe(deriveMasterIdeaBundle(base).master_idea.id);
  });
});

describe('semantic fingerprints', () => {
  it('are stable, 8-hex, and independent per dimension', () => {
    const b = deriveMasterIdeaBundle(base);
    for (const v of Object.values(b.fingerprint)) expect(v).toMatch(/^[0-9a-f]{8}$/);
    const changedCta = deriveMasterIdeaBundle({ ...base, ctaStrategy: 'Start free trial' });
    expect(changedCta.fingerprint.cta).not.toBe(b.fingerprint.cta);
    // changing only the CTA must not change the topic fingerprint
    expect(changedCta.fingerprint.topic).toBe(b.fingerprint.topic);
  });

  it('normalization ignores case/punctuation/whitespace', () => {
    expect(normalizeForFingerprint('  Hello, WORLD!! ')).toBe('hello world');
    expect(fingerprint('Hello world')).toBe(fingerprint('  hello,  world '));
  });
});

describe('backward compatibility', () => {
  it('degrades gracefully with empty input (no throw, safe defaults)', () => {
    const b = deriveMasterIdeaBundle({});
    expect(b.master_idea.id).toMatch(/^mi_[0-9a-f]{8}$/);
    expect(b.master_idea.core_message).toBe('Untitled idea');
    expect(b.variant.variant_type).toBe('post');
  });

  it('readMasterIdeaBundle tolerates absent metadata (older rows) → null', () => {
    expect(readMasterIdeaBundle(null)).toBeNull();
    expect(readMasterIdeaBundle({})).toBeNull();
    expect(readMasterIdeaBundle({ some: 'legacy', content: 'x' })).toBeNull();
  });

  it('round-trips a stamped bundle out of a content envelope', () => {
    const bundle = deriveMasterIdeaBundle(base);
    const envelope = { generated_content: 'x', ...bundle };
    const read = readMasterIdeaBundle(envelope);
    expect(read?.master_idea.id).toBe(bundle.master_idea.id);
    expect(read?.variant.variant_id).toBe(bundle.variant.variant_id);
  });

  it('survives the real persistence path — JSON.stringify(enriched) → parse', () => {
    // Mirrors generate-weekly-structure: content = JSON.stringify(enriched)
    const enriched: Record<string, unknown> = { platform: 'linkedin', generated_content: 'body' };
    const bundle = deriveMasterIdeaBundle({ ...base, contentType: 'carousel' });
    enriched.master_idea = bundle.master_idea;
    enriched.variant = bundle.variant;
    enriched.fingerprint = bundle.fingerprint;
    enriched.master_idea_version = bundle.master_idea_version;

    const persisted = JSON.stringify(enriched);
    const read = readMasterIdeaBundle(JSON.parse(persisted));
    expect(read).not.toBeNull();
    expect(read?.master_idea.id).toBe(bundle.master_idea.id);
    expect(read?.variant.variant_type).toBe('carousel');
    // Adaptation preserves it: a spread {...parsed} keeps the block intact.
    const adapted = { ...JSON.parse(persisted), platform_variants: [{ platform: 'facebook' }] };
    expect(readMasterIdeaBundle(adapted)?.master_idea.id).toBe(bundle.master_idea.id);
  });

  it('planner-emitted seed groups cross-format assets under ONE master idea (IMPL-004A)', () => {
    // Simulate the planner: one base business concept → a shared seed. Each format
    // derives its own topic/angle but references the SAME seed.
    const seed = normalizeForFingerprint('How teams reach value in a week');
    const blog = deriveMasterIdeaBundle({ campaignId: 'c1', weekNumber: 2, ideaKey: seed, contentType: 'blog', topicTitle: 'Deep dive: value in a week' });
    const carousel = deriveMasterIdeaBundle({ campaignId: 'c1', weekNumber: 2, ideaKey: seed, contentType: 'carousel', topicTitle: 'Value in a week (5 slides)' });
    const infographic = deriveMasterIdeaBundle({ campaignId: 'c1', weekNumber: 2, ideaKey: seed, contentType: 'infographic', topicTitle: 'Value in a week — one chart' });
    // Same idea despite different formats + different derived topics
    expect(carousel.master_idea.id).toBe(blog.master_idea.id);
    expect(infographic.master_idea.id).toBe(blog.master_idea.id);
    // Variants remain distinct
    expect(new Set([blog.variant.variant_id, carousel.variant.variant_id, infographic.variant.variant_id]).size).toBe(3);
    // A different base concept → a different idea, even in the same week
    const other = deriveMasterIdeaBundle({ campaignId: 'c1', weekNumber: 2, ideaKey: normalizeForFingerprint('Cutting onboarding costs'), contentType: 'blog' });
    expect(other.master_idea.id).not.toBe(blog.master_idea.id);
  });

  it('every asset belongs to exactly ONE master idea', () => {
    const assets = ['blog', 'carousel', 'post', 'thread'].map((ct) =>
      deriveMasterIdeaBundle({ ...base, contentType: ct }));
    for (const a of assets) {
      expect(a.variant.master_idea_id).toBe(a.master_idea.id); // variant points at exactly its idea
      expect(a.master_idea.id).toMatch(/^mi_[0-9a-f]{8}$/);
    }
  });
});
