export interface ThreadImprovementSuggestion {
  category: 'hook' | 'progression' | 'payoff';
  message: string;
}

export function getThreadImprovementSuggestions(): ThreadImprovementSuggestion[] {
  return [
    { category: 'hook', message: 'Open with a stronger first post so the thread earns the click-through.' },
    { category: 'progression', message: 'Make each step in the thread feel sequential instead of repetitive.' },
    { category: 'payoff', message: 'End with a clearer synthesis so the reader leaves with one strong lesson.' },
  ];
}
