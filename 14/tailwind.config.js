/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        bms: {
          bg: '#0a0e1a',
          panel: '#111827',
          border: '#1e3a5f',
          accent: '#00f0ff',
          accent2: '#0088ff',
          ok: '#00e676',
          warn: '#ff8c00',
          error: '#ff1744',
          text: '#e0f7ff',
          textDim: '#8ba3c7',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
        sans: ['Noto Sans SC', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-cyan': '0 0 12px rgba(0,240,255,0.4)',
        'glow-green': '0 0 12px rgba(0,230,118,0.4)',
        'glow-orange': '0 0 12px rgba(255,140,0,0.4)',
        'glow-red': '0 0 12px rgba(255,23,68,0.4)',
        'inner-panel': 'inset 0 1px 0 rgba(255,255,255,0.05)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink': 'blink 1s step-end infinite',
        'ripple': 'ripple 0.8s ease-out',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        ripple: {
          '0%': { transform: 'scale(0.8)', opacity: '0.8' },
          '100%': { transform: 'scale(2)', opacity: '0' },
        }
      },
    },
  },
  plugins: [],
};
