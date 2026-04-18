'use client';

import FormatSelectionPage from '../../components/content/FormatSelectionPage';
import {
  NEWSLETTER_ENGINE_CONFIGS,
  resolveNewsletterTargetWords,
} from '../../lib/newsletter/newsletterContentEngine';

const NEWSLETTER_FORMATS = NEWSLETTER_ENGINE_CONFIGS.map((config) => ({
  value: config.value,
  label: config.title,
  description: `${config.description} Built for teams that need clearer editorial structure, stronger point of view, and a more executive-ready read.`,
  wordRange: `${resolveNewsletterTargetWords(config.value, 'standard').toLocaleString()}+ words`,
}));

export default function NewsletterCreatePage() {
  return (
    <FormatSelectionPage
      title="Create a Newsletter"
      subtitle="Choose the newsletter format that best matches the level of depth, editorial posture, and audience value you want to deliver."
      icon="N"
      formats={NEWSLETTER_FORMATS}
      generatePath="/newsletters/intelligence"
      accentColor="amber"
      pageTitle="Create Newsletter"
    />
  );
}
