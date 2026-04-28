import React from 'react';
import Link from 'next/link';
import { HelpCircle, BookOpen, Mail, Activity } from 'lucide-react';

const GlobalFooter: React.FC = () => {
  return (
    <footer className="border-t border-gray-200 bg-white mt-auto">
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          {/* Left: copyright */}
          <span>&copy; {new Date().getFullYear()} Omnivyra. All rights reserved.</span>

          {/* Right: links */}
          <div className="flex items-center gap-4">
            <a
              href="https://docs.omnivyra.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-gray-600 transition-colors"
            >
              <BookOpen className="h-3 w-3" />
              Docs
            </a>
            <Link href="/pricing" className="flex items-center gap-1 hover:text-gray-600 transition-colors">
              <HelpCircle className="h-3 w-3" />
              Help
            </Link>
            <a
              href="mailto:support@omnivyra.com"
              className="flex items-center gap-1 hover:text-gray-600 transition-colors"
            >
              <Mail className="h-3 w-3" />
              Support
            </a>
            <Link href="/privacy" className="hover:text-gray-600 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-gray-600 transition-colors">
              Terms of Service
            </Link>
            <Link href="/data-deletion" className="hover:text-gray-600 transition-colors">
              Data Deletion
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default GlobalFooter;
