'use client';

import React from 'react';
import Link from 'next/link';

const links = [
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
  { label: 'Blog', href: '/blog' },
  { label: 'Login', href: '/login' },
];

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-[#F5F9FF] px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <Link href="/" className="flex shrink-0 items-center" aria-label="Omnivyra home">
          {/* Plain img so the logo renders at full resolution (no Next/Image downscale = no blur) */}
          <img
            src="/logo.png"
            alt="Omnivyra"
            width={120}
            height={120}
            className="h-16 w-auto object-contain object-left sm:h-20"
          />
        </Link>
        <nav className="flex flex-wrap items-center justify-center gap-6">
          {links.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="text-base font-medium text-gray-600 hover:text-gray-900"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <p className="mx-auto mt-6 max-w-6xl text-center text-sm text-gray-500">
        © {new Date().getFullYear()} Omnivyra. All rights reserved.
      </p>
    </footer>
  );
}
