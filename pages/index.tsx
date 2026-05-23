import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';
import { clearBrowserAuthState } from '../utils/authStorage';
import { apiFetch } from '../lib/apiFetch';
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

      // Retry up to 3 times on transient errors (404 / 5xx). The 404 case
      // is common in `next dev` when the API route hasn't been compiled
      // yet on the first hit; cascading to a fallback route under those
      // conditions previously triggered the "Failed to load client build
      // manifest" hot-reload error. Linear backoff (0.4s, 0.8s) gives dev
      // enough time to compile.
      const fetchRoute = async (): Promise<Response> => {
        return apiFetch('/api/auth/post-login-route');
      };

      const pinnedHome = (): string => {
        try {
          return localStorage.getItem('pin_home') === 'true' ? '/home' : '/command-center';
        } catch {
          return '/command-center';
        }
      };

      try {
        let res: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          res = await fetchRoute();
          if (res.status !== 404 && res.status < 500) break;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }

        if (!res || res.status === 401 || res.status === 403) {
          await supabase.auth.signOut();
          clearBrowserAuthState({ preservePkce: false });
          setSessionFound(false);
          setLoading(false);
          return;
        }

        if (!res.ok) {
          // Persistent transient failure after retries. The user IS
          // authenticated — do NOT fall back to the marketing landing
          // page (which would be confusing). Route to the default home;
          // by now the dev server has had ~1.2s to compile.
          router.replace(pinnedHome());
          return;
        }

        const { route: dest } = (await res.json()) as { route?: string };
        const target = dest ?? '/command-center';
        const pinned = pinnedHome() === '/home';
        router.replace(target === '/command-center' && pinned ? '/home' : target);
      } catch {
        // Network-layer error after retries — still authenticated, so
        // route to default home rather than the landing page.
        router.replace(pinnedHome());
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
        <title>Active Intelligence for AI-Era Marketing Operations | Omnivyra</title>
        <meta
          name="description"
          content="Omnivyra generates Active Intelligence from digital authority signals, visibility reporting, campaigns, content, market context, recommendations, and connected marketing operations."
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
