import FormatSelectionPage from '../../components/content/FormatSelectionPage';
import { ARTICLE_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function ArticleCreatePage() {
  return (
    <FormatSelectionPage
      title="Create an Article"
      subtitle="Choose the article structure that best fits the level of analysis, framing, and authority you want the final piece to project."
      icon="📰"
      formats={ARTICLE_FORMAT_OPTIONS}
      generatePath="/articles/intelligence"
      accentColor="orange"
      pageTitle="Create Article"
    />
  );
}
