/**
 * /reports/content-readiness
 * Content Readiness Report — shows the generated report for the company.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { CheckCircle, TrendingUp, Lightbulb, ArrowLeft } from 'lucide-react';

export default function ContentReadinessPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50">
      {/* Navigation */}
      <div className="border-b border-gray-200 bg-white sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            onClick={() => router.push('/reports')}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Reports
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 text-white py-12 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md px-4 py-2 rounded-full text-sm font-semibold mb-4">
            <CheckCircle className="h-4 w-4" />
            Content Readiness Report
          </div>
          <h1 className="text-4xl font-bold mb-4">Your Content Analysis</h1>
          <p className="text-blue-100 text-lg">
            Detailed insights to help you rank, convert, and grow.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {[
            {
              icon: TrendingUp,
              title: 'Content Score',
              description: 'Overall readiness score based on your current content strategy.',
              color: 'blue',
            },
            {
              icon: CheckCircle,
              title: 'SEO Health',
              description: 'Technical and on-page SEO factors affecting your visibility.',
              color: 'green',
            },
            {
              icon: Lightbulb,
              title: 'Opportunities',
              description: 'Top recommendations to improve content performance.',
              color: 'purple',
            },
          ].map((card) => (
            <div key={card.title} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className={`inline-flex items-center justify-center h-10 w-10 rounded-lg bg-${card.color}-100 text-${card.color}-600 mb-4`}>
                <card.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{card.title}</h3>
              <p className="text-sm text-gray-500">{card.description}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500 text-lg">
            Your report is being generated. Check back in a few minutes.
          </p>
          <button
            onClick={() => router.push('/reports')}
            className="mt-6 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Back to Reports
          </button>
        </div>
      </div>
    </div>
  );
}
