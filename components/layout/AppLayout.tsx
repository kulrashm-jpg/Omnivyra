import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import GlobalHeader from './GlobalHeader';
import GlobalFooter from './GlobalFooter';
import Breadcrumbs from './Breadcrumbs';
import CommandPalette from './CommandPalette';
import SectionNav from './SectionNav';
import RewardToast from '../retention/RewardToast';
import CreditWarningBanner from '../billing/CreditWarningBanner';
import { useRetention } from '../../hooks/useRetention';
// P2-1 — variant experience shared analytics + operator-controls
// providers. Mounted at AppLayout so every authenticated page gets a
// single shared fetch instead of N consumer-level fetches.
import { VariantExperienceShell } from '../variant-experience/VariantExperienceShell';

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * AppLayout — wraps all authenticated pages with consistent header + footer.
 * Applied in _app.tsx for non-public routes.
 *
 * Structure:
 *   <GlobalHeader />     sticky top
 *   <main>               flex-1 content area
 *     {children}
 *   </main>
 *   <GlobalFooter />     bottom
 */
const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const router = useRouter();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const { pendingReward, dismissReward } = useRetention();
  const isCommandCenterHome = router.pathname === '/command-center';

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  return (
    <VariantExperienceShell>
      <div className="flex min-h-screen flex-col bg-gray-50">
        <GlobalHeader onOpenCommandPalette={() => setIsCommandPaletteOpen(true)} />
        <CreditWarningBanner />
        <CommandPalette open={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} />
        {!isCommandCenterHome ? (
          <div className="relative z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="mx-auto flex max-w-screen-xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
              <div className="min-w-0">
                <Breadcrumbs />
                <SectionNav />
              </div>
            </div>
          </div>
        ) : null}
        <main className="relative z-0 flex-1">
          {children}
        </main>
        <GlobalFooter />
        <RewardToast reward={pendingReward} onDismiss={dismissReward} />
      </div>
    </VariantExperienceShell>
  );
};

export default AppLayout;
