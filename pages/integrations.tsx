import type { GetServerSideProps } from 'next';
import IntegrationsContainer from '@/features/integrations/container/IntegrationsContainer';

export const getServerSideProps: GetServerSideProps = async (context) => {
  const focus = typeof context.query.focus === 'string' ? context.query.focus : '';
  if (focus === 'website' || focus === 'data') {
    return { props: {} };
  }

  const query = new URLSearchParams();
  query.set('focus', 'website');
  for (const [key, value] of Object.entries(context.query)) {
    if (key === 'focus' || value == null) continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => query.append(key, entry));
      continue;
    }
    query.set(key, value);
  }

  return {
    redirect: {
      destination: `/integrations?${query.toString()}`,
      permanent: false,
    },
  };
};

export default function IntegrationsPage() {
  return <IntegrationsContainer />;
}
