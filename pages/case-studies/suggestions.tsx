import ManagedSuggestionsPage from '../../components/content/ManagedSuggestionsPage';

export default function CaseStudySuggestionsPage() {
  return (
    <ManagedSuggestionsPage
      contentType="case-study"
      title="Case Study Suggestions"
      stepLabel="Step 3 of 4 - Fine-tune content direction"
      heading="Case Study Suggestions"
      theme="amber"
      generatePath="/case-studies/generate"
      backPath="/case-studies/template"
    />
  );
}
