import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/integrations',
      permanent: false,
    },
  };
};

export default function SettingsIntegrationsAliasPage() {
  return null;
}
