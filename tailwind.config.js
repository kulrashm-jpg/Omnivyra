/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      // ── CREATOR-139 canonical tokens (MUST mirror lib/platform/ui/tokens.ts).
      // Added as NEW named tokens only — no Tailwind default is overridden, so all
      // existing classes/usages are unaffected (zero regression). New code consumes
      // these (bg-primary-600, text-text-muted, z-modal, …); legacy migrates onto them.
      colors: {
        omnivyra: {
          start: '#0B5ED7',
          end: '#1EA7FF',
          light: '#F5F9FF',
        },
        primary: { 50: '#eef5ff', 100: '#d9e8ff', 500: '#1EA7FF', 600: '#0B5ED7', 700: '#084aac' },
        surface: { DEFAULT: '#ffffff', 2: '#f8fafc', dark: '#0b1220', 'dark-2': '#020617' },
        // (slate/neutral text + borders surfaced as canonical names)
        ink: { DEFAULT: '#0f172a', muted: '#64748b', subtle: '#94a3b8', 'on-dark': '#f8fafc' },
        line: { DEFAULT: '#e2e8f0', strong: '#cbd5e1', dark: '#1f2937' },
        success: '#16a34a',
        warning: '#d97706',
        danger: '#ef4444',
        info: '#0ea5e9',
      },
      zIndex: {
        dropdown: '1000', sticky: '1100', overlay: '1200', modal: '1300', toast: '1400',
      },
      transitionDuration: {
        fast: '120ms', base: '200ms', slow: '320ms',
      },
      transitionTimingFunction: {
        'ovr-out': 'cubic-bezier(0.16,1,0.3,1)', 'ovr-in': 'cubic-bezier(0.4,0,1,1)',
      },
      borderRadius: {
        'omnivyra': '16px',
        // canonical (prefixed to avoid collision with Tailwind's sm/md/lg defaults)
        'ovr-sm': '4px', 'ovr-md': '8px', 'ovr-lg': '12px', 'ovr-xl': '16px',
      },
      boxShadow: {
        'omnivyra': '0 4px 20px rgba(11, 94, 215, 0.08)',
        'omnivyra-glow': '0 0 40px rgba(30, 167, 255, 0.25)',
        'ovr-sm': '0 1px 2px rgba(15,23,42,0.06)',
        'ovr-md': '0 4px 12px rgba(15,23,42,0.08)',
        'ovr-lg': '0 10px 30px rgba(15,23,42,0.10)',
        'ovr-overlay': '0 20px 60px rgba(15,23,42,0.25)',
      },
      animation: {
        'pulse': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce': 'bounce 1s infinite',
        'spin': 'spin 1s linear infinite',
        'ping': 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite',
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
