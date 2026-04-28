import React from 'react';
import {
  X, Link2, Linkedin, Twitter, Facebook, Mail,
  CheckCircle2, Download, ExternalLink,
} from 'lucide-react';
import { useShare, type SharePayload } from '../../hooks/useShare';

// ─────────────────────────────────────────────────────────────────────────────
// ShareModal — universal share dialog for any content type
//
// Usage:
//   <ShareModal
//     open={showShare}
//     onClose={() => setShowShare(false)}
//     payload={{ type: 'blog', id: 'abc', title: 'My Post' }}
//   />
// ─────────────────────────────────────────────────────────────────────────────

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  payload: SharePayload | null;
  onDownload?: () => void;  // optional PDF/image download callback
}

export default function ShareModal({ open, onClose, payload, onDownload }: ShareModalProps) {
  const share = useShare(payload);

  if (!open || !payload) return null;

  const socialButtons = [
    { label: 'LinkedIn', icon: Linkedin, onClick: share.shareToLinkedin, color: 'hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200' },
    { label: 'Twitter',  icon: Twitter,  onClick: share.shareToTwitter,  color: 'hover:bg-sky-50 hover:text-sky-700 hover:border-sky-200' },
    { label: 'Facebook', icon: Facebook, onClick: share.shareToFacebook, color: 'hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200' },
    { label: 'Email',    icon: Mail,     onClick: share.shareViaEmail,   color: 'hover:bg-gray-100 hover:text-gray-700 hover:border-gray-300' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-50 px-4">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Share</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Content preview */}
            <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{payload.title}</p>
                {payload.description && (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{payload.description}</p>
                )}
                <p className="text-xs text-blue-600 mt-1 truncate">{share.url}</p>
              </div>
            </div>

            {/* Copy link */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Link</label>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 truncate">
                  {share.url}
                </div>
                <button
                  onClick={share.copyLink}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                    share.copied
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-gray-900 text-white hover:bg-gray-800'
                  }`}
                >
                  {share.copied ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Link2 className="w-3.5 h-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Social share buttons */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Share to</label>
              <div className="mt-1.5 grid grid-cols-4 gap-2">
                {socialButtons.map((btn) => (
                  <button
                    key={btn.label}
                    onClick={btn.onClick}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border border-gray-200 text-gray-500 transition-all ${btn.color}`}
                  >
                    <btn.icon className="w-5 h-5" />
                    <span className="text-xs font-medium">{btn.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Download (optional) */}
            {onDownload && (
              <button
                onClick={() => {
                  onDownload();
                  share.track('download');
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download PDF
              </button>
            )}
          </div>

          {/* Footer: branding */}
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-400 text-center">
              Shared with <a href="https://omnivyra.com" target="_blank" rel="noopener noreferrer" className="font-medium text-gray-500 hover:text-blue-600">Omnivyra</a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
