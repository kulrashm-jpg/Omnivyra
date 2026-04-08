export const NEWSLETTER_TEMPLATE_VISUALS: Record<string, {
  eyebrow: string;
  accentClassName: string;
  surfaceClassName: string;
  badgeClassName: string;
  stats: Array<{ label: string; value: string }>;
}> = {
  'Minimal Thesis': {
    eyebrow: 'Insight Letter',
    accentClassName: 'from-violet-400 via-fuchsia-400 to-rose-400',
    surfaceClassName: 'bg-gradient-to-br from-violet-50/90 via-white to-fuchsia-50/70',
    badgeClassName: 'bg-violet-100 text-violet-700',
    stats: [
      { label: 'Feel', value: 'Sharp + forwardable' },
      { label: 'Layout', value: 'Lean thesis flow' },
    ],
  },
  'Split-Screen Insight': {
    eyebrow: 'Insight Letter',
    accentClassName: 'from-indigo-400 via-sky-400 to-cyan-400',
    surfaceClassName: 'bg-gradient-to-br from-indigo-50/90 via-white to-cyan-50/70',
    badgeClassName: 'bg-sky-100 text-sky-700',
    stats: [
      { label: 'Feel', value: 'Editorial + visual' },
      { label: 'Layout', value: 'Split-screen contrast' },
    ],
  },
  'Signal Radar': {
    eyebrow: 'Weekly Brief',
    accentClassName: 'from-amber-400 via-orange-400 to-rose-400',
    surfaceClassName: 'bg-gradient-to-br from-amber-50/90 via-white to-orange-50/70',
    badgeClassName: 'bg-amber-100 text-amber-700',
    stats: [
      { label: 'Feel', value: 'Signal-first' },
      { label: 'Layout', value: 'Radar card rhythm' },
    ],
  },
  'Analyst Board': {
    eyebrow: 'Weekly Brief',
    accentClassName: 'from-yellow-400 via-amber-400 to-lime-400',
    surfaceClassName: 'bg-gradient-to-br from-yellow-50/90 via-white to-lime-50/70',
    badgeClassName: 'bg-lime-100 text-lime-700',
    stats: [
      { label: 'Feel', value: 'Compact + analytical' },
      { label: 'Layout', value: 'Board-style scan' },
    ],
  },
  'Strategy Memo': {
    eyebrow: 'Strategic Letter',
    accentClassName: 'from-sky-400 via-cyan-400 to-blue-500',
    surfaceClassName: 'bg-gradient-to-br from-sky-50/90 via-white to-cyan-50/70',
    badgeClassName: 'bg-sky-100 text-sky-700',
    stats: [
      { label: 'Feel', value: 'Consulting memo' },
      { label: 'Layout', value: 'Thesis-led strategy' },
    ],
  },
  'Market Map': {
    eyebrow: 'Strategic Letter',
    accentClassName: 'from-blue-400 via-indigo-400 to-violet-500',
    surfaceClassName: 'bg-gradient-to-br from-blue-50/90 via-white to-violet-50/70',
    badgeClassName: 'bg-indigo-100 text-indigo-700',
    stats: [
      { label: 'Feel', value: 'Market framing' },
      { label: 'Layout', value: 'See vs notice' },
    ],
  },
  'Operator Playbook': {
    eyebrow: 'Action Letter',
    accentClassName: 'from-emerald-400 via-teal-400 to-cyan-500',
    surfaceClassName: 'bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/70',
    badgeClassName: 'bg-emerald-100 text-emerald-700',
    stats: [
      { label: 'Feel', value: 'Practical + clear' },
      { label: 'Layout', value: 'Playbook flow' },
    ],
  },
  'Sprint Sheet': {
    eyebrow: 'Action Letter',
    accentClassName: 'from-teal-400 via-cyan-400 to-sky-500',
    surfaceClassName: 'bg-gradient-to-br from-teal-50/90 via-white to-sky-50/70',
    badgeClassName: 'bg-cyan-100 text-cyan-700',
    stats: [
      { label: 'Feel', value: 'Fast operator mode' },
      { label: 'Layout', value: 'Sprint checklist' },
    ],
  },
};

export function getNewsletterTemplateVisuals(name: string) {
  return NEWSLETTER_TEMPLATE_VISUALS[name] ?? {
    eyebrow: 'Newsletter Layout',
    accentClassName: 'from-amber-400 via-orange-400 to-rose-400',
    surfaceClassName: 'bg-white',
    badgeClassName: 'bg-amber-100 text-amber-700',
    stats: [
      { label: 'Feel', value: 'Newsletter-native' },
      { label: 'Layout', value: 'Custom newsletter flow' },
    ],
  };
}
