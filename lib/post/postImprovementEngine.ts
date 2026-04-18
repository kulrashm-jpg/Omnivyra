export interface PostImprovementSuggestion {
  category: 'hook' | 'clarity' | 'cta' | 'engagement';
  message: string;
}

export function getPostImprovementSuggestions(): PostImprovementSuggestion[] {
  return [
    { category: 'hook', message: 'Strengthen the opening line so the post earns attention in the first sentence.' },
    { category: 'clarity', message: 'Keep the post focused on one core takeaway instead of stacking multiple ideas.' },
    { category: 'cta', message: 'End with a clearer interaction prompt, decision takeaway, or next action.' },
  ];
}
