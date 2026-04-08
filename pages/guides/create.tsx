import FormatSelectionPage from '../../components/content/FormatSelectionPage';
import { GUIDE_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function GuideCreatePage() {
  return (
    <FormatSelectionPage
      title="Create a Guide"
      subtitle="Choose your guide format"
      icon="📚"
      formats={GUIDE_FORMAT_OPTIONS}
      generatePath="/guides/generate"
      accentColor="violet"
      pageTitle="Create Guide"
    />
  );
}
