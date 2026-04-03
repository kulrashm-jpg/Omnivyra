/**
 * DETERMINISTIC CONTENT PATH
 *
 * Fast, template-based generation for engagement responses (< 100ms latency).
 * No AI calls, no queue wait - instant responses for community engagement.
 *
 * Falls back to AI refinement if template doesn't match or user requests it.
 */

/**
 * Detect sentiment from text using keyword matching (no ML)
 */
function detectSimpleSentiment(text: string): {
  sentiment: 'positive' | 'negative' | 'neutral' | 'question';
  score: number; // -1 to 1
} {
  const lower = text.toLowerCase();

  // Question detection
  if (lower.includes('?') || lower.includes('how ') || lower.includes('what ') || lower.includes('why ')) {
    return { sentiment: 'question', score: 0 };
  }

  // Positive indicators
  const positiveWords = ['great', 'love', 'amazing', 'awesome', 'thanks', 'appreciate', 'excellent', 'best', 'fantastic', 'wonderful'];
  const positiveCount = positiveWords.filter(w => lower.includes(w)).length;

  // Negative indicators
  const negativeWords = ['hate', 'horrible', 'bad', 'worst', 'terrible', 'awful', 'shame', 'problem', 'issue', 'complaint'];
  const negativeCount = negativeWords.filter(w => lower.includes(w)).length;

  if (positiveCount > negativeCount) {
    return { sentiment: 'positive', score: Math.min(positiveCount * 0.3, 1) };
  }
  if (negativeCount > positiveCount) {
    return { sentiment: 'negative', score: Math.max(negativeCount * -0.3, -1) };
  }

  return { sentiment: 'neutral', score: 0 };
}

/**
 * Generate a deterministic CTA based on platform
 */
function generateCompanyCtaForPlatform(platform: string): string {
  const ctas: Record<string, string> = {
    linkedin: 'Feel free to reach out if you want to discuss further',
    x: 'DM us to continue the conversation',
    twitter: 'DM us to continue the conversation',
    instagram: 'Check our bio for more',
    facebook: 'Message us for more details',
    reddit: 'Reply below to continue the discussion',
    default: 'Thanks for the engagement!',
  };

  return ctas[platform.toLowerCase()] || ctas.default;
}

/**
 * Generate an engagement hook based on message tone
 */
function generateEngagementHook(platform: string): string {
  const hooks: Record<string, string> = {
    linkedin: 'Insightful point',
    x: 'Good take',
    twitter: 'Good take',
    instagram: 'Love this energy',
    facebook: 'Thanks for sharing',
    reddit: 'Great comment',
    default: 'Thanks for engaging',
  };

  return hooks[platform.toLowerCase()] || hooks.default;
}

/**
 * Generate a solution hint based on message context
 */
function generateSolutionHint(message: string, platform: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('price') || lower.includes('cost')) {
    return 'Check our pricing page for details on that';
  }
  if (lower.includes('how') || lower.includes('help')) {
    return 'Happy to help - reach out directly';
  }
  if (lower.includes('when') || lower.includes('timeline')) {
    return 'We can discuss timing with you directly';
  }

  return 'Let us know if you need clarification';
}

/**
 * Generate deterministic engagement response (instant, no AI)
 *
 * Templates per engagement type + sentiment routing
 */
export function generateDeterministicEngagementResponse(input: {
  message: string;
  platform: string;
  company_tone: string;
  engagement_type: 'reply' | 'new_conversation' | 'dm' | 'outreach_response';
}): string | null {
  const sentiment = detectSimpleSentiment(input.message);
  const cta = generateCompanyCtaForPlatform(input.platform);
  const hook = generateEngagementHook(input.platform);
  const solutionHint = generateSolutionHint(input.message, input.platform);

  // Route by engagement type
  if (input.engagement_type === 'reply') {
    if (sentiment.sentiment === 'question') {
      return `${hook}! ${solutionHint}. ${cta}.`;
    }
    if (sentiment.sentiment === 'negative') {
      return `We hear you. We'd like to make this right. ${cta}?`;
    }
    if (sentiment.sentiment === 'positive') {
      return `Thanks so much! ${hook}. ${cta}.`;
    }
    // neutral
    return `${hook}. ${cta}.`;
  }

  if (input.engagement_type === 'new_conversation') {
    if (sentiment.sentiment === 'question') {
      return `Thanks for reaching out. ${solutionHint} ${cta}.`;
    }
    if (sentiment.sentiment === 'negative') {
      return `We appreciate the direct feedback. ${cta} to discuss.`;
    }
    return `Great to hear from you! ${cta}.`;
  }

  if (input.engagement_type === 'dm') {
    if (sentiment.sentiment === 'question') {
      return `Thanks for the message. Happy to help with that. ${cta}.`;
    }
    return `Thanks for reaching out directly! ${cta}.`;
  }

  if (input.engagement_type === 'outreach_response') {
    if (sentiment.sentiment === 'positive') {
      return `Fantastic! We're excited too. ${cta}.`;
    }
    if (sentiment.sentiment === 'negative') {
      return `Thanks for considering us. We're open to feedback. ${cta}?`;
    }
    return `Appreciate the response. ${cta}.`;
  }

  return null;
}

/**
 * Check if a response is valid (basic checks)
 */
export function validateResponse(response: string): boolean {
  if (!response || response.length < 5) return false;
  if (response.length > 280 && response.length < 1000) return false; // Reject responses that are too long for social but not long enough to be substantial
  if (response.length > 1000) return false; // Too long for engagement response
  if (response.length <= 280) return true; // Social media standard
  return true;
}

/**
 * Get cached angle from recent effectiveness data
 * Returns most effective angle for this company + content_type
 */
export async function selectCachedAngleIfAvailable(input: {
  company_id: string;
  content_type: string;
}): Promise<string | null> {
  try {
    const { getAngleEffectiveness } = await import('./contentFeedbackLoop');
    const angles = await getAngleEffectiveness(input.company_id, input.content_type);

    if (Object.keys(angles).length === 0) return null;

    // Return most effective angle
    const sorted = Object.entries(angles).sort((a, b) => b[1].effectiveness - a[1].effectiveness);
    return sorted[0]?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Quick platform variant rendering (deterministic rules)
 * Convert master content to platform-specific format
 */
export function renderQuickVariant(masterContent: string, platform: string): string {
  const platformLower = platform.toLowerCase();

  // X/Twitter: truncate to 280
  if (platformLower === 'x' || platformLower === 'twitter') {
    return masterContent.slice(0, 280).trim();
  }

  // Instagram: add hashtag suggestion
  if (platformLower === 'instagram') {
    const hashtags = ['#content', '#insights', '#strategy'].join(' ');
    return `${masterContent}\n\n${hashtags}`;
  }

  // LinkedIn: add professional sign-off
  if (platformLower === 'linkedin') {
    return `${masterContent}\n\nWhat are your thoughts?`;
  }

  // Facebook: add engagement question
  if (platformLower === 'facebook') {
    return `${masterContent}\n\nWhat do you think?`;
  }

  // Default: return as-is
  return masterContent;
}

