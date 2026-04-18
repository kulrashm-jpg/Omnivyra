import type { FormatOption, ManagedIntelligenceProps, RecommendationCard } from './types';

export function getFormatLabel(formatOptions: FormatOption[], formatValue: string) {
  return formatOptions.find((option) => option.value === formatValue)?.label ?? formatValue;
}

export function parseWordTarget(wordRange: string | undefined, fallback: number) {
  if (!wordRange) return fallback;
  const matches = wordRange.match(/\d[\d,]*/g);
  if (!matches || matches.length === 0) return fallback;
  const values = matches
    .map((value) => Number(value.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return fallback;
  return Math.max(...values);
}

export function getSuggestionCount(targetWords: number) {
  if (targetWords <= 900) return 3;
  if (targetWords <= 1600) return 5;
  if (targetWords <= 2500) return 6;
  return 8;
}

export function getDepthLabel(targetWords: number) {
  if (targetWords <= 900) return 'Lean depth';
  if (targetWords <= 1600) return 'Balanced depth';
  if (targetWords <= 2500) return 'Deep depth';
  return 'Authority depth';
}

export function buildDefaultRecommendations(
  contentType: ManagedIntelligenceProps['contentType'],
  formatLabel: string,
  companyName: string,
  existingCount: number,
): RecommendationCard[] {
  const existingNote = existingCount > 0
    ? `Build on what ${companyName} has already published, but take the angle deeper and more distinctly.`
    : `Use this as a foundational piece that establishes how ${companyName} should sound in this category.`;

  switch (contentType) {
    case 'article':
      return [
        {
          topic: `${formatLabel}: the overlooked shift shaping your market`,
          reason: `A strong article should feel reported, current, and defensible. ${existingNote}`,
          intent: 'authority',
          priority: 'high',
        },
        {
          topic: `What leaders are still getting wrong about this trend`,
          reason: 'This gives you a crisp editorial angle with room for evidence, tension, and practical interpretation.',
          intent: 'authority',
          priority: 'high',
        },
        {
          topic: `A data-backed explainer for buyers evaluating the space`,
          reason: 'This works well when you want depth, trust, and clearer commercial relevance without sounding promotional.',
          intent: 'conversion',
          priority: 'medium',
        },
      ];
    case 'guide':
      return [
        {
          topic: `${formatLabel}: the complete operating playbook`,
          reason: 'Guides work best when they reduce confusion and give the reader a usable system, not just advice.',
          intent: 'authority',
          priority: 'high',
        },
        {
          topic: `How to execute this workflow step by step without common mistakes`,
          reason: 'This is a strong fit for practical readers who want structure, checkpoints, and error prevention.',
          intent: 'conversion',
          priority: 'high',
        },
        {
          topic: `The reference guide teams keep bookmarking and reusing`,
          reason: 'A reusable guide can become a durable traffic and trust asset when the structure is clear and specific.',
          intent: 'retention',
          priority: 'medium',
        },
      ];
    case 'story':
      return [
        {
          topic: `${formatLabel}: the turning point that changed everything`,
          reason: 'Stories become memorable when they center on a clear inflection point, emotional stakes, and a real shift.',
          intent: 'awareness',
          priority: 'high',
        },
        {
          topic: `Behind the decision that looked risky at the time`,
          reason: 'This creates built-in narrative tension and gives the piece a natural arc from uncertainty to insight.',
          intent: 'authority',
          priority: 'medium',
        },
        {
          topic: `A founder or customer moment with a lasting business lesson`,
          reason: 'This is ideal when you want narrative energy without losing strategic relevance.',
          intent: 'conversion',
          priority: 'medium',
        },
      ];
    case 'whitepaper':
      return [
        {
          topic: `${formatLabel}: the market problem serious buyers can no longer ignore`,
          reason: 'Whitepapers need stronger depth and sharper business stakes than ordinary articles. This topic sets up both.',
          intent: 'authority',
          priority: 'high',
        },
        {
          topic: `The framework decision-makers need before investing in this category`,
          reason: 'A whitepaper should help a buyer think better, justify action, and compare paths with confidence.',
          intent: 'conversion',
          priority: 'high',
        },
        {
          topic: `What the evidence suggests about where the industry is heading next`,
          reason: 'This supports a more research-led angle with room for analysis, synthesis, and a modern authority voice.',
          intent: 'authority',
          priority: 'medium',
        },
      ];
    case 'newsletter':
      return [
        {
          topic: `${formatLabel}: the operating shift smart teams should notice early`,
          reason: 'A strong newsletter should feel current, intentional, and valuable enough to forward internally.',
          intent: 'authority',
          priority: 'high',
        },
        {
          topic: 'What changed this week and what it really means for operators',
          reason: 'This creates a more executive-useful briefing by prioritizing interpretation over recap.',
          intent: 'retention',
          priority: 'high',
        },
        {
          topic: 'The decision lens readers should carry into the next quarter',
          reason: 'This supports a sharper strategic point of view with clear downstream action for leadership teams.',
          intent: 'conversion',
          priority: 'medium',
        },
      ];
    case 'post':
      return [
        {
          topic: `${formatLabel}: the contrarian signal your buyers should not miss`,
          reason: 'A strong B2B post should feel sharp, current, and specific enough to earn attention quickly without reading like filler.',
          intent: 'authority',
          priority: 'high',
        },
        {
          topic: 'One practical takeaway your market can apply today',
          reason: 'This angle works well when you want a concise post that feels useful, credible, and easy to share internally.',
          intent: 'conversion',
          priority: 'high',
        },
        {
          topic: 'A concise point of view tied to a recent market shift',
          reason: 'Timely shortform performs better when it adds interpretation, not just commentary.',
          intent: 'awareness',
          priority: 'medium',
        },
      ];
    case 'thread':
      return [
        {
          topic: `${formatLabel}: the 5-part breakdown buyers will actually read to the end`,
          reason: 'A great thread needs momentum, a clear arc, and enough differentiation to keep each post earning the next one.',
          intent: 'authority',
          priority: 'high',
        },
        {
          topic: 'A step-by-step sequence that simplifies a complex strategic topic',
          reason: 'Threads are especially effective when they teach progressively instead of dumping too much context upfront.',
          intent: 'conversion',
          priority: 'high',
        },
        {
          topic: 'The sequence behind a market insight, framework, or founder lesson',
          reason: 'This gives the thread a stronger narrative payoff and makes the final CTA feel earned.',
          intent: 'retention',
          priority: 'medium',
        },
      ];
    case 'case-study':
      return [
        {
          topic: `How a client moved from friction to measurable results`,
          reason: 'A strong case study is proof-led: tension, intervention, outcomes, and takeaways need to be visible immediately.',
          intent: 'conversion',
          priority: 'high',
        },
        {
          topic: `The implementation story behind a result worth believing`,
          reason: 'This creates a more credible case study because it explains what actually happened, not just the final numbers.',
          intent: 'authority',
          priority: 'high',
        },
        {
          topic: `What others can learn from this transformation`,
          reason: 'This gives the piece reusable value so it performs as both proof and education.',
          intent: 'retention',
          priority: 'medium',
        },
      ];
    default:
      return [];
  }
}
