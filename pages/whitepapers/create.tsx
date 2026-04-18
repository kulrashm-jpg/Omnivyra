import FormatSelectionPage from '../../components/content/FormatSelectionPage';
import { WHITEPAPER_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function WhitepaperCreatePage() {
  return (
    <FormatSelectionPage
      title="Create a Whitepaper"
      subtitle="Choose the whitepaper structure that best fits the depth, decision-stage clarity, and authority the asset needs to deliver."
      icon="📄"
      formats={WHITEPAPER_FORMAT_OPTIONS}
      generatePath="/whitepapers/intelligence"
      accentColor="blue"
      pageTitle="Create Whitepaper"
    />
  );
}
