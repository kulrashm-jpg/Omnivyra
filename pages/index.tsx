import React, { useState } from 'react';
import HeroSection from '../components/landing/HeroSection';
import ReadinessModal from '../components/landing/ReadinessModal';
import HowItWorks from '../components/landing/HowItWorks';
import TestimonialsSection from '../components/landing/TestimonialsSection';
import PricingPreview from '../components/landing/PricingPreview';
import Footer from '../components/landing/Footer';

export default function Home() {
  const [readinessModalOpen, setReadinessModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F5F9FF]">
      <main>
        <HeroSection onCheckReadiness={() => setReadinessModalOpen(true)} />
        <HowItWorks />
        <TestimonialsSection />
        <PricingPreview />
        <Footer />
      </main>
      <ReadinessModal open={readinessModalOpen} onClose={() => setReadinessModalOpen(false)} />
    </div>
  );
}
