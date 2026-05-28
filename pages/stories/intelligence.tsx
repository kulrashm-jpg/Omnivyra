import ManagedIntelligencePage from '../../components/content/ManagedIntelligencePage';
import { STORY_FORMAT_OPTIONS } from '../../lib/blog/blogStructureTemplates';

export default function StoryIntelligencePage() {
  return (
    <ManagedIntelligencePage
      contentType="story"
      pageTitle="Story Intelligence"
      eyebrow="Story Intelligence"
      heading="Create a Story"
      icon="📖"
      accentClassName="text-pink-700"
      accentSurfaceClassName="from-pink-50 via-white to-rose-50"
      backPath="/stories/create"
      createPath="/stories/create"
      templatePath="/stories/template"
      generatePath="/stories/generate"
      formatOptions={STORY_FORMAT_OPTIONS}
      defaultFormat="short_story"
      creationModePicker={{
        enabled: true,
        flavor: 'longform',
        editorPath: '/stories/new',
      }}
    />
  );
}
