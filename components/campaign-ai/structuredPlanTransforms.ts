import type { PlatformCustomization, RefinedDay, StructuredPlan } from './types';

export function updatePlanWithRefinedDay(plan: StructuredPlan, refinedDay: RefinedDay): StructuredPlan {
  return {
    weeks: plan.weeks.map((week) => {
      if (week.week !== refinedDay.week) return week;
      const daily = week.daily || [];
      const updated = daily.map((day) =>
        day.day.toLowerCase() === refinedDay.day.toLowerCase()
          ? {
              day: refinedDay.day,
              objective: refinedDay.objective,
              content: refinedDay.content,
              platforms: refinedDay.platforms,
            }
          : day
      );
      const found = daily.some((day) => day.day.toLowerCase() === refinedDay.day.toLowerCase());
      return {
        ...week,
        daily: found
          ? updated
          : [
              ...updated,
              {
                day: refinedDay.day,
                objective: refinedDay.objective,
                content: refinedDay.content,
                platforms: refinedDay.platforms,
              },
            ],
      };
    }),
  };
}

export function updatePlanWithPlatformCustomization(
  plan: StructuredPlan,
  customization: PlatformCustomization
): StructuredPlan {
  const targetDay = customization.day.toLowerCase();
  return {
    weeks: plan.weeks.map((week) => ({
      ...week,
      daily: (week.daily || []).map((day) =>
        day.day.toLowerCase() === targetDay
          ? {
              ...day,
              platforms: {
                ...day.platforms,
                ...customization.platforms,
              },
            }
          : day
      ),
    })),
  };
}

export function convertStructuredPlanToProgram(plan: StructuredPlan) {
  const platformSet = new Set<string>();
  const weeks = plan.weeks.map((week) => {
    const theme = week.phase_label || week.theme || `Week ${week.week}`;
    let content: Array<{ type: string; platform: string; description: string; day: string }> = [];
    if (week.daily?.length) {
      content = week.daily.flatMap((day) =>
        Object.entries(day.platforms || {}).map(([platform, text]) => {
          platformSet.add(platform);
          return { type: 'post', platform, description: text, day: day.day };
        })
      );
    } else if (week.platform_allocation && Object.keys(week.platform_allocation).length > 0) {
      for (const [platform, count] of Object.entries(week.platform_allocation)) {
        platformSet.add(platform);
        for (let i = 0; i < count; i += 1) {
          content.push({
            type: 'post',
            platform,
            description: `Content for ${theme} (${platform})`,
            day: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i % 7],
          });
        }
      }
    }

    return { weekNumber: week.week, theme, content };
  });

  return {
    description: 'AI-generated 12-week content program',
    totalContent: weeks.reduce((sum, week) => sum + week.content.length, 0),
    platforms: Array.from(platformSet).map((platform) => platform.charAt(0).toUpperCase() + platform.slice(1)),
    weeks,
  };
}
