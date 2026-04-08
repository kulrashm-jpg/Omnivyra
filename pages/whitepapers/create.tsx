import FormatSelectionPage from '../../components/content/FormatSelectionPage';
import { WHITEPAPER_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function WhitepaperCreatePage() {
  return (
    <FormatSelectionPage
      title="Create a Whitepaper"
      subtitle="Choose your whitepaper format"
      icon="📄"
      formats={WHITEPAPER_FORMAT_OPTIONS}
      generatePath="/whitepapers/generate"
      accentColor="blue"
      pageTitle="Create Whitepaper"
    />
  );
}
