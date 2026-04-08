import FormatSelectionPage from '../../components/content/FormatSelectionPage';
import { STORY_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function StoryCreatePage() {
  return (
    <FormatSelectionPage
      title="Create a Story"
      subtitle="Choose your narrative format"
      icon="📖"
      formats={STORY_FORMAT_OPTIONS}
      generatePath="/stories/generate"
      accentColor="pink"
      pageTitle="Create Story"
    />
  );
}
