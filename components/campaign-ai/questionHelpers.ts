export function extractLastQuestionLine(text: string): string | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].endsWith('?')) return lines[i];
  }
  return null;
}

export function extractDurationWeeksFromHistory(
  history: Array<{ type: 'user' | 'ai'; message: string }>
): number | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (msg.type !== 'user') continue;
    const match = msg.message.match(/\b(\d{1,2})\s*(?:week|weeks)\b/i);
    if (!match) continue;
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= 52) return n;
  }
  return undefined;
}

export function enrichPlanningQuestionExamples(text: string): string {
  if (!text) return text;

  const exampleForQuestion = (question: string): string => {
    const q = question.toLowerCase();
    if (
      q.includes('do you want to proceed with') ||
      q.includes('proceed with') ||
      (q.includes('recommend') && q.includes('week')) ||
      q.includes('would you like me to create') ||
      (q.includes('create your') && q.includes('plan now'))
    ) return '(e.g., "Yes, proceed with 12 weeks." or "Use 8 weeks instead.")';
    if (q.includes('target audience')) return '(e.g., professionals, entrepreneurs, students, parents, educators, homemakers, job seekers, freelancers, retirees)';
    if (q.includes('start') && q.includes('date')) return '(e.g., 2026-08-15)';
    if (q.includes('duration') || (q.includes('how many') && q.includes('week'))) return '(e.g., 6, 8, or 12 weeks)';
    if (q.includes('platform')) return '(e.g., LinkedIn, Instagram, YouTube, X)';
    if (q.includes('content') && (q.includes('have') || q.includes('existing'))) return '(e.g., 3 videos, 10 posts, 2 blogs)';
    if (q.includes('capacity') || q.includes('per week')) return '(e.g., 2 videos/week, 5 posts/week, 1 blog/week)';
    if (q.includes('success metric') || q.includes('kpi') || (q.includes('metric') && q.includes('track'))) return '(e.g., 5% engagement rate, 200 qualified leads/month, 20 demo bookings/month)';
    if (q.includes('objective') || q.includes('goal')) return '(e.g., awareness, leads, conversions, retention)';
    if (q.includes('budget')) return '(e.g., $500/month, $2,000/quarter)';
    if (q.includes('region') || q.includes('geo') || q.includes('market')) return '(e.g., US, UK, India, global)';
    if (q.includes('core message') || q.includes('key message') || q.includes('audience to remember') || q.includes('one thing you want people to remember')) return '';
    if ((q.includes('after reading your content') && q.includes('what should people do')) || q.includes('what do you want people to do after')) return '';
    return '';
  };

  const withExample = (line: string): string => {
    const example = exampleForQuestion(line);
    if (!example) return line.replace(/\s+\(e\.g\.,?.*\)/i, '');
    if (/\(e\.g\.,?.*\)/i.test(line)) return line.replace(/\(e\.g\.,?.*\)/i, example);
    return `${line} ${example}`;
  };

  return text
    .split('\n')
    .map((line) => (line.includes('?') ? withExample(line) : line))
    .join('\n');
}
