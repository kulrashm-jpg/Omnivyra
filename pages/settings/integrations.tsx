import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/integrations?focus=website',
      permanent: false,
    },
  };
};

export default function SettingsIntegrationsAliasPage() {
  return null;
}
