import { extractPlatforms } from './chatHelpers';

export function generateDefaultProgram(platformLabels: Record<string, string>) {
  const weeks = [];
  const platforms = Object.keys(platformLabels);

  for (let i = 1; i <= 12; i += 1) {
    weeks.push({
      weekNumber: i,
      theme: `Week ${i} Theme`,
      content: platforms.map((platform) => ({
        type: 'post',
        platform,
        description: `Week ${i} ${platform} content`,
      })),
    });
  }

  return {
    description: 'AI-generated 12-week content program',
    totalContent: weeks.reduce((sum, week) => sum + week.content.length, 0),
    platforms: platforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)),
    weeks,
  };
}

export function extractProgramFromResponse(
  response: string,
  platformQuickPickOptions: string[],
  platformExtractCandidates: string[],
  platformLabels: Record<string, string>
) {
  try {
    const weeks = [];
    const platforms = platformQuickPickOptions;

    for (let i = 1; i <= 12; i += 1) {
      const weekMatch = response.match(new RegExp(`Week ${i}[\\s\\S]*?(?=Week ${i + 1}|$)`, 'i'));
      if (!weekMatch) continue;
      const weekContent = weekMatch[0];
      const content: Array<{ type: string; platform: string; description: string }> = [];

      platforms.forEach((platform) => {
        const label = String(platform || '').trim();
        if (!label) return;
        const hay = weekContent.toLowerCase();
        const needle = label.toLowerCase();
        const matches = needle === 'x' ? /\bx\b/.test(hay) : hay.includes(needle);
        if (!matches) return;
        const key = extractPlatforms(label, platformExtractCandidates)?.[0] || needle;
        content.push({
          type: 'post',
          platform: key,
          description: `Week ${i} ${label} content`,
        });
      });

      weeks.push({
        weekNumber: i,
        theme: `Week ${i} Theme`,
        content: content.length > 0 ? content : [{ type: 'post', platform: 'linkedin', description: `Week ${i} content` }],
      });
    }

    return {
      description: 'AI-generated campaign content program',
      totalContent: weeks.reduce((sum, week) => sum + week.content.length, 0),
      platforms,
      weeks: weeks.length > 0 ? weeks : generateDefaultProgram(platformLabels).weeks,
    };
  } catch (error) {
    console.error('Error extracting program:', error);
    return generateDefaultProgram(platformLabels);
  }
}
