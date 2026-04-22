import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async (context) => {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(context.query)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        query.append(key, entry);
      }
      continue;
    }

    if (typeof value === 'string') {
      query.append(key, value);
    }
  }

  const destination = `/api/auth/x/callback${query.toString() ? `?${query.toString()}` : ''}`;

  return {
    redirect: {
      destination,
      permanent: false,
    },
  };
};

export default function XCallbackBridge() {
  return null;
}
