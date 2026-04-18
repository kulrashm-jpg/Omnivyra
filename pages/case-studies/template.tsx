import ManagedTemplateSelectionPage from '../../components/content/ManagedTemplateSelectionPage';

export default function CaseStudyTemplatePage() {
  return (
    <ManagedTemplateSelectionPage
      contentType="case-study"
      pageTitle="Case Study Templates"
      heading="Choose a Case Study Template"
      subtitle="Select a proof-led layout first, then continue with the system recommendation or one of your saved custom templates."
      accentColor="amber"
      backPath="/case-studies/create"
      suggestionsPath="/case-studies/suggestions"
      generatePath="/case-studies/generate"
    />
  );
}
