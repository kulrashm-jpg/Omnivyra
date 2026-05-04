import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/content-studio',
      permanent: false,
    },
  };
};

export default function ContentAliasPage() {
  return null;
}
