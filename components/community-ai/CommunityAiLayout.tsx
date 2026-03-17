import React from 'react';
import Header from '../Header';
import ChatPanel from './ChatPanel';

type CommunityAiLayoutProps = {
  title: string;
  context?: Record<string, unknown>;
  children: React.ReactNode;
  /** Set to false to hide the Engagement Chat sidebar (e.g. on config/connectors page). Default: true. */
  showChat?: boolean;
};

export default function CommunityAiLayout({ title, context = {}, children, showChat = true }: CommunityAiLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{title}</h1>
        </div>
        <div className={showChat ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 sm:gap-6' : 'max-w-4xl'}>
          <div className="space-y-4 sm:space-y-6 min-w-0">{children}</div>
          {showChat && (
            <div className="lg:sticky lg:top-6 h-fit">
              <ChatPanel context={context} title="Engagement Chat" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

