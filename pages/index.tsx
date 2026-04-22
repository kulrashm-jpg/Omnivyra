import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';
import MarketingLandingPage, { LANDING_FAQS } from '../components/landing/MarketingLandingPage';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [sessionFound, setSessionFound] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let done = false;

    async function route(session: { access_token: string } | null) {
      if (done) return;

      if (!session) {
        done = true;
        setSessionFound(false);
        setLoading(false);
        return;
      }

      done = true;
      setSessionFound(true);

      try {
        const res = await fetch('/api/auth/post-login-route', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.status === 401 || res.status === 403) {
          await supabase.auth.signOut();
          setSessionFound(false);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          router.replace('/dashboard');
          return;
        }
        const { route: dest } = (await res.json()) as { route?: string };
        const pinned = localStorage.getItem('pin_home') === 'true';
        const target = dest ?? '/command-center';
        router.replace(target === '/command-center' && pinned ? '/home' : target);
      } catch {
        const pinned = localStorage.getItem('pin_home') === 'true';
        router.replace(pinned ? '/home' : '/command-center');
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void route(session);
      } else if (event === 'SIGNED_OUT') {
        void route(null);
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!done) void route(data.session);
    });

    return () => subscription.unsubscribe();
  }, [router]);

  if (loading && !sessionFound) return null;

  if (sessionFound) return null;

  return (
    <>
      <Head>
        <title>Marketing Performance Analytics and Action System | OmniVyra</title>
        <meta
          name="description"
          content="OmniVyra helps teams analyze marketing performance, identify trends and drop-offs, prioritize next best actions, and execute from one system."
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: LANDING_FAQS.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: item.answer,
                },
              })),
            }),
          }}
        />
      </Head>
      <MarketingLandingPage />
    </>
  );
}
