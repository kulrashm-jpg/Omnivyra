import React, { useState, useEffect } from 'react';
import { X, Users, ArrowRight, CheckCircle2 } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// InviteFriends — non-intrusive invite prompt
//
// Triggers after milestones (streak, first content, etc.)
// Dismissible, persisted, max 1 show per session.
// ─────────────────────────────────────────────────────────────────────────────

const INVITE_DISMISSED_KEY = 'omnivyra_invite_dismissed';
const INVITE_SESSION_KEY = 'omnivyra_invite_shown_session';

interface InviteFriendsProps {
  trigger: 'streak' | 'content' | 'campaign' | 'manual';
  className?: string;
}

export default function InviteFriends({ trigger, className = '' }: InviteFriendsProps) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Check if permanently dismissed or already shown this session
    const dismissed = localStorage.getItem(INVITE_DISMISSED_KEY) === 'true';
    const shownThisSession = sessionStorage.getItem(INVITE_SESSION_KEY) === 'true';

    if (!dismissed && !shownThisSession) {
      setVisible(true);
      sessionStorage.setItem(INVITE_SESSION_KEY, 'true');
    }
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    localStorage.setItem(INVITE_DISMISSED_KEY, 'true');
  };

  const handleCopyLink = async () => {
    const inviteUrl = `${window.location.origin}/signup?ref=invite`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (!visible) return null;

  const messages: Record<string, { title: string; body: string }> = {
    streak: {
      title: 'You\'re on a roll!',
      body: 'Know someone who could benefit from AI-powered content? Share the love.',
    },
    content: {
      title: 'Nice work on your first content!',
      body: 'Know a colleague who creates content? They might love this too.',
    },
    campaign: {
      title: 'Campaign launched!',
      body: 'Know a marketing team that could use a content engine?',
    },
    manual: {
      title: 'Enjoying Omnivyra?',
      body: 'Invite your team or share with a colleague who creates content.',
    },
  };

  const msg = messages[trigger] || messages.manual;

  return (
    <div className={`bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{msg.title}</p>
            <p className="text-sm text-gray-600 mt-0.5">{msg.body}</p>
          </div>
        </div>
        <button onClick={handleDismiss} className="text-gray-400 hover:text-gray-600 p-1 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={handleCopyLink}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            copied
              ? 'bg-green-100 text-green-700 border border-green-200'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {copied ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Link copied!
            </>
          ) : (
            <>
              Copy invite link
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
        <a
          href="/team-management"
          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          Invite by email
        </a>
      </div>
    </div>
  );
}
