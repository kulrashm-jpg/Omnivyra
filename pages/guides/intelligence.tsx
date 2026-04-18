import ManagedIntelligencePage from '../../components/content/ManagedIntelligencePage';
import { GUIDE_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function GuideIntelligencePage() {
  return (
    <ManagedIntelligencePage
      contentType="guide"
      pageTitle="Guide Intelligence"
      eyebrow="Guide Intelligence"
      heading="Create a Guide"
      icon="📚"
      accentClassName="text-violet-700"
      accentSurfaceClassName="from-violet-50 via-white to-purple-50"
      backPath="/guides/create"
      createPath="/guides/create"
      templatePath="/guides/template"
      generatePath="/guides/generate"
      formatOptions={GUIDE_FORMAT_OPTIONS}
      defaultFormat="comprehensive"
    />
  );
}
