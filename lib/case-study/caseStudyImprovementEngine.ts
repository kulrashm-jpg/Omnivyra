export interface CaseStudyImprovementSuggestion {
  category: 'proof' | 'narrative' | 'outcome';
  message: string;
}

export function getCaseStudyImprovementSuggestions(): CaseStudyImprovementSuggestion[] {
  return [
    { category: 'proof', message: 'Add more measurable evidence so the case study feels concrete and persuasive.' },
    { category: 'narrative', message: 'Clarify the before/after arc so the transformation is easier to follow.' },
    { category: 'outcome', message: 'State the business result more explicitly and tie it to the intervention.' },
  ];
}
