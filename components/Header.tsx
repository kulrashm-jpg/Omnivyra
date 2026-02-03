import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from './CompanyContext';
import { supabase } from '../utils/supabaseClient';

const Header: React.FC = () => {
  const router = useRouter();
  const { userName, selectedCompanyId } = useCompanyContext();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const displayName = userName && userName.trim().length > 0 ? userName : 'User';

  const handleLogout = async () => {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="bg-white/90 backdrop-blur-sm border-b border-gray-200/60 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/dashboard')}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
            >
              Home
            </button>
            <button
              onClick={() => router.push('/community-ai')}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors"
            >
              Community AI
            </button>
          </div>
          <div className="text-lg font-semibold text-gray-900">
            Content Manager App
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-700">
            <div>Logged in as: {displayName}</div>
            {!selectedCompanyId && (
              <div className="text-gray-500">No company selected</div>
            )}
            <button
              onClick={handleLogout}
              disabled={isSigningOut}
              className="bg-white text-gray-700 px-4 py-2 rounded-xl font-semibold hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {isSigningOut ? 'Signing out...' : 'Logout'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Header;
