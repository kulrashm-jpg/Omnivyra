export const sampleCampaign = {
  id: 'sample-campaign',
  name: 'Spring Launch Momentum Plan',
  description: 'Launch your product across LinkedIn and email with one clear message and three execution steps.',
  status: 'planning',
  current_stage: 'planning',
  timeframe: '4 weeks',
  start_date: new Date().toISOString(),
  end_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 28).toISOString(),
  created_at: new Date().toISOString(),
  stats: {
    goals: 3,
    weeklyPlans: 4,
    dailyPlans: 12,
    totalContent: 9,
  },
};

export const sampleLead = {
  id: 'sample-lead',
  name: 'Maya Thompson',
  email: 'maya@northpeak.io',
  phone: '+1 415 555 0143',
  source: 'form_embed',
  form_id: 'sample-form',
  integration_id: null,
  is_test: false,
  created_at: new Date().toISOString(),
};

export const sampleForm = {
  id: 'sample-form',
  company_id: 'sample-company',
  name: 'Demo Booking Form',
  fields: [
    { name: 'name', label: 'Full Name', type: 'text', required: true },
    { name: 'email', label: 'Work Email', type: 'email', required: true },
  ],
  brand: {
    heading: 'Book a quick strategy session',
    description: 'See how your next campaign can turn attention into qualified leads.',
    submit_label: 'Book my session',
    success_message: 'You are in. We will send the next steps shortly.',
    primary_color: '#0B5ED7',
    font: 'system',
  },
  integration_id: null,
  created_at: new Date().toISOString(),
};

export function buildSampleContent(platform = 'linkedin', contentType = 'video') {
  return {
    id: `sample-content-${Date.now()}`,
    title: '3 signals your CRM is slowing down revenue',
    content:
      'Most teams do not need more leads. They need a cleaner way to follow up on the right ones.\n\nIn this post, show the three warning signs and end with one practical next step your audience can take today.',
    platform,
    contentType,
    hashtags: ['#RevOps', '#CRM', '#B2BGrowth'],
    mediaUrls: [],
    status: 'draft' as const,
    aiGenerated: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
