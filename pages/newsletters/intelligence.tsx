import ManagedIntelligencePage from '../../components/content/ManagedIntelligencePage';
import {
  NEWSLETTER_ENGINE_CONFIGS,
  resolveNewsletterTargetWords,
} from '../../lib/newsletter/newsletterContentEngine';

const NEWSLETTER_FORMATS = NEWSLETTER_ENGINE_CONFIGS.map((config) => ({
  value: config.value,
  label: config.title,
  description: config.description,
  wordRange: `${resolveNewsletterTargetWords(config.value, 'standard').toLocaleString()}+ words`,
}));

export default function NewsletterIntelligencePage() {
  return (
    <ManagedIntelligencePage
      contentType="newsletter"
      pageTitle="Newsletter Intelligence"
      eyebrow="Newsletter Intelligence"
      heading="Create a Newsletter"
      icon="N"
      accentClassName="text-amber-700"
      accentSurfaceClassName="from-amber-50 via-white to-orange-50"
      backPath="/newsletters/create"
      createPath="/newsletters/create"
      templatePath="/newsletters/template"
      generatePath="/newsletters/generate"
      formatOptions={NEWSLETTER_FORMATS}
      defaultFormat="insight-letter"
    />
  );
}
