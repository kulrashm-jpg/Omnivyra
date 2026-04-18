import FormatSelectionPage from '../../components/content/FormatSelectionPage';
import { GUIDE_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function GuideCreatePage() {
  return (
    <FormatSelectionPage
      title="Create a Guide"
      subtitle="Choose the guide structure that best fits the teaching depth, clarity, and long-term authority you want the final asset to build."
      icon="📚"
      formats={GUIDE_FORMAT_OPTIONS}
      generatePath="/guides/intelligence"
      accentColor="violet"
      pageTitle="Create Guide"
    />
  );
}
