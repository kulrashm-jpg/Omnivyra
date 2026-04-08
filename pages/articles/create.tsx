import FormatSelectionPage from '../../components/content/FormatSelectionPage';
import { ARTICLE_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function ArticleCreatePage() {
  return (
    <FormatSelectionPage
      title="Create an Article"
      subtitle="Choose your article format"
      icon="📰"
      formats={ARTICLE_FORMAT_OPTIONS}
      generatePath="/articles/generate"
      accentColor="orange"
      pageTitle="Create Article"
    />
  );
}
