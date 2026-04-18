import ManagedTemplateSelectionPage from '../../components/content/ManagedTemplateSelectionPage';

export default function StoryTemplatePage() {
  return (
    <ManagedTemplateSelectionPage
      contentType="story"
      pageTitle="Story Templates"
      heading="Choose a Story Template"
      subtitle="Choose the narrative structure that matches your story format, then continue with a managed or custom template."
      accentColor="pink"
      backPath="/stories/create"
      suggestionsPath="/stories/suggestions"
      generatePath="/stories/generate"
    />
  );
}
