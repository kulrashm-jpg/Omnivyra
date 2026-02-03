import React from 'react';

type SectionCardProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export default function SectionCard({ title, subtitle, children }: SectionCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {subtitle ? <p className="text-sm text-gray-600">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

