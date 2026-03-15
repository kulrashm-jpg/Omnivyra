import React from 'react';
import Header from '../Header';
import ChatPanel from './ChatPanel';

type CommunityAiLayoutProps = {
  title: string;
  context?: Record<string, unknown>;
  children: React.ReactNode;
  /** Set to false to hide the Community AI Chat sidebar (e.g. on config/connectors page). Default: true. */
  showChat?: boolean;
};

export default function CommunityAiLayout({ title, context = {}, children, showChat = true }: CommunityAiLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        </div>
        <div className={showChat ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6' : 'max-w-4xl'}>
          <div className="space-y-6">{children}</div>
          {showChat && (
            <div className="lg:sticky lg:top-6 h-fit">
              <ChatPanel context={context} title="Community AI Chat" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

