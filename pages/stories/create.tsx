import FormatSelectionPage from '../../components/content/FormatSelectionPage';
import { STORY_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function StoryCreatePage() {
  return (
    <FormatSelectionPage
      title="Create a Story"
      subtitle="Choose the narrative structure that best matches the emotional arc, message depth, and audience resonance you want the story to carry."
      icon="📖"
      formats={STORY_FORMAT_OPTIONS}
      generatePath="/stories/intelligence"
      accentColor="pink"
      pageTitle="Create Story"
    />
  );
}
