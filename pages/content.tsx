import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/content-creation',
      permanent: false,
    },
  };
};

export default function ContentAliasPage() {
  return null;
}
