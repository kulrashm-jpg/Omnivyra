import ManagedIntelligencePage from '../../components/content/ManagedIntelligencePage';
import { ARTICLE_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function ArticleIntelligencePage() {
  return (
    <ManagedIntelligencePage
      contentType="article"
      pageTitle="Article Intelligence"
      eyebrow="Article Intelligence"
      heading="Create an Article"
      icon="📰"
      accentClassName="text-orange-700"
      accentSurfaceClassName="from-orange-50 via-white to-amber-50"
      backPath="/articles/create"
      createPath="/articles/create"
      templatePath="/articles/template"
      generatePath="/articles/generate"
      formatOptions={ARTICLE_FORMAT_OPTIONS}
      defaultFormat="narrative"
    />
  );
}
