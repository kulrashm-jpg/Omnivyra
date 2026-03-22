/**
 * Content Repurposing Engine
 * Generates LinkedIn posts (3 variations), Twitter/X thread, email summary,
 * and a key insights card from structured blog post data.
 * Pure functions — no API calls, no side effects.
 */

import type { ContentBlock } from './blockTypes';
import { extractBlogContext } from './blockExtractor';

// ── Input ─────────────────────────────────────────────────────────────────────

export interface RepurposeInput {
  title:       string;
  slug:        string;
  excerpt:     string;
  tags:        string[];
  category:    string;
  keyInsights: string[];
  summary:     string;
  h2Headings:  string[];
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface LinkedInPost {
  variation: 'hook' | 'insight' | 'story';
  label:     string;
  content:   string;
  hashtags:  string[];
  charCount: number;
}

export interface TwitterThread {
  tweets: string[];
}

export interface EmailSummary {
  subject:  string;
  preview:  string;
  body:     string;
  ctaLabel: string;
  ctaUrl:   string;
}

export interface KeyInsightsCard {
  headline: string;
  points:   string[];
  footer:   string;
}

export interface RepurposedContent {
  linkedInPosts:   LinkedInPost[];
  twitterThread:   TwitterThread;
  emailSummary:    EmailSummary;
  keyInsightsCard: KeyInsightsCard;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashtagsFromTags(tags: string[], category: string, max = 5): string[] {
  const all = [...tags, category]
    .filter(Boolean)
    .map((t) => '#' + t.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, ''))
    .filter((t) => t.length > 1);
  return [...new Set(all)].slice(0, max);
}

function blogUrl(slug: string): string {
  return `https://omnivyra.com/blog/${slug}`;
}

function firstSentence(text: string): string {
  const m = text.match(/[^.!?]+[.!?]/);
  return m ? m[0].trim() : text.slice(0, 140).trim();
}

function bullets(items: string[], prefix = '→'): string {
  return items.filter(Boolean).slice(0, 5).map((i) => `${prefix} ${i.trim()}`).join('\n');
}

function li(post: LinkedInPost): LinkedInPost {
  return { ...post, charCount: post.content.length };
}

// ── LinkedIn: Hook / Challenge ────────────────────────────────────────────────

function linkedInHook(input: RepurposeInput, hashtags: string[]): LinkedInPost {
  const { title, slug, keyInsights, summary, category } = input;

  const opener = `Most people misunderstand ${category.toLowerCase() || 'this topic'}.`;
  const bridge = summary
    ? firstSentence(summary)
    : `I wrote a deep-dive on "${title}" and the findings changed how I approach this.`;

  const insightSection = keyInsights.length > 0
    ? `Here's what you need to know:\n\n${bullets(keyInsights.slice(0, 4))}`
    : `The full breakdown covers what works, what doesn't, and the nuances most people miss.`;

  const content = [
    opener,
    '',
    bridge,
    '',
    insightSection,
    '',
    `Full read → ${blogUrl(slug)}`,
    '',
    hashtags.join(' '),
  ].join('\n');

  return li({ variation: 'hook', label: 'Hook / Challenge', content, hashtags, charCount: 0 });
}

// ── LinkedIn: Insights / Data ─────────────────────────────────────────────────

function linkedInInsight(input: RepurposeInput, hashtags: string[]): LinkedInPost {
  const { title, slug, keyInsights, h2Headings, excerpt } = input;

  const opener = excerpt
    ? firstSentence(excerpt)
    : `A structured breakdown of "${title}" — the key points that actually matter.`;

  const sections = h2Headings.length > 0
    ? h2Headings.slice(0, 4).map((h, i) => `${i + 1}. ${h}`).join('\n')
    : keyInsights.length > 0
      ? bullets(keyInsights.slice(0, 4), '✦')
      : 'Covers frameworks, common mistakes, and what actually works.';

  const content = [
    `📊 ${title}`,
    '',
    opener,
    '',
    sections,
    '',
    `Drop a 🔖 if you find this useful.`,
    '',
    `Full breakdown → ${blogUrl(slug)}`,
    '',
    hashtags.join(' '),
  ].join('\n');

  return li({ variation: 'insight', label: 'Insights / Data', content, hashtags, charCount: 0 });
}

// ── LinkedIn: Story / Personal ────────────────────────────────────────────────

function linkedInStory(input: RepurposeInput, hashtags: string[]): LinkedInPost {
  const { title, slug, keyInsights, summary, category } = input;

  const hook = `If you work in ${category || 'this space'}, this one is for you.`;
  const context = summary
    ? firstSentence(summary)
    : `I put everything I know about "${title}" into one article.`;

  const takeaways = keyInsights.length > 0
    ? [`The 3 things worth remembering:`, '', bullets(keyInsights.slice(0, 3), '✅')]
    : [`It covers what works, what doesn't, and why the nuance matters.`];

  const content = [
    hook,
    '',
    context,
    '',
    ...takeaways,
    '',
    `Worth a read if this is on your radar 👇`,
    blogUrl(slug),
    '',
    hashtags.join(' '),
  ].join('\n');

  return li({ variation: 'story', label: 'Story / Personal', content, hashtags, charCount: 0 });
}

// ── Twitter/X thread ──────────────────────────────────────────────────────────

function buildTwitterThread(input: RepurposeInput): TwitterThread {
  const { title, slug, keyInsights, h2Headings, summary, category, tags } = input;
  const tweets: string[] = [];

  // 1: Hook
  tweets.push(
    `Everything you need to know about "${title}" — in one thread. 🧵\n\n(Save this, you'll want to come back.)`
  );

  // 2: Why it matters
  const why = summary
    ? firstSentence(summary)
    : `${category || 'This topic'} is one of the most overlooked areas — and it costs people real results.`;
  tweets.push(why);

  // 3-6: One point per tweet
  const points = keyInsights.length > 0 ? keyInsights.slice(0, 4) : h2Headings.slice(0, 4);
  points.forEach((point, i) => {
    tweets.push(`${i + 3}/ ${point.trim()}`);
  });

  // Pad to at least 6 tweets
  if (tweets.length < 6) {
    tweets.push(
      `The key is showing up consistently. Most people quit before the compounding effect kicks in.`
    );
  }

  // Second-to-last: common mistake
  tweets.push(
    `The most common mistake? Chasing tactics before mastering fundamentals.\n\nDon't do that.`
  );

  // Last: CTA
  const tagStr = tags.slice(0, 2).map((t) => `#${t.replace(/\s+/g, '')}`).join(' ');
  tweets.push(
    `Full breakdown (with examples, frameworks, and references):\n\n→ ${blogUrl(slug)}\n\n${tagStr}`
  );

  return { tweets };
}

// ── Email summary ─────────────────────────────────────────────────────────────

function buildEmailSummary(input: RepurposeInput): EmailSummary {
  const { title, slug, excerpt, keyInsights, summary, category } = input;

  const subject  = title;
  const preview  = excerpt ? firstSentence(excerpt) : `A breakdown of ${title}`;
  const bodyLead = summary || excerpt || `We just published a new piece on ${category || 'a topic worth your time'}.`;

  const bulletBlock = keyInsights.length > 0
    ? `Key takeaways:\n${keyInsights.slice(0, 4).map((i) => `• ${i.trim()}`).join('\n')}`
    : '';

  const body = [firstSentence(bodyLead), '', bulletBlock].filter(Boolean).join('\n');

  return {
    subject,
    preview,
    body,
    ctaLabel: 'Read the full article →',
    ctaUrl:   blogUrl(slug),
  };
}

// ── Key insights card ─────────────────────────────────────────────────────────

function buildKeyInsightsCard(input: RepurposeInput): KeyInsightsCard {
  const { title, slug, keyInsights, h2Headings } = input;

  const points = keyInsights.length > 0
    ? keyInsights.slice(0, 5)
    : h2Headings.slice(0, 5).map((h) => `Covers: ${h}`);

  return {
    headline: `🔑 ${title}`,
    points:   points.filter(Boolean),
    footer:   `Full article → ${blogUrl(slug)}`,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateRepurposedContent(input: RepurposeInput): RepurposedContent {
  const hashtags = hashtagsFromTags(input.tags, input.category);
  return {
    linkedInPosts:   [linkedInHook(input, hashtags), linkedInInsight(input, hashtags), linkedInStory(input, hashtags)],
    twitterThread:   buildTwitterThread(input),
    emailSummary:    buildEmailSummary(input),
    keyInsightsCard: buildKeyInsightsCard(input),
  };
}

// ── Block extraction ──────────────────────────────────────────────────────────

export function extractRepurposeInput(post: {
  title:          string;
  slug:           string;
  excerpt?:       string;
  tags:           string[];
  category:       string;
  content_blocks?: ContentBlock[] | null;
}): RepurposeInput {
  const { key_insights, summary, h2_headings } = extractBlogContext(post.content_blocks);
  return {
    title:       post.title    ?? '',
    slug:        post.slug     ?? '',
    excerpt:     post.excerpt  ?? '',
    tags:        post.tags     ?? [],
    category:    post.category ?? '',
    keyInsights: key_insights,
    summary,
    h2Headings:  h2_headings,
  };
}
