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
        'deep-space': '#0a1628',
        'dark-panel': '#0f1f38',
        'panel-border': '#1e3a5f',
        'tech-cyan': '#00d4ff',
        'tech-cyan-dim': '#0099cc',
        'warning-red': '#ff4757',
        'warning-orange': '#ffa502',
        'status-green': '#2ed573',
        'status-yellow': '#ffd700',
      },
      fontFamily: {
        display: ['Orbitron', 'monospace'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(0, 212, 255, 0.3)',
        'glow-red': '0 0 20px rgba(255, 71, 87, 0.5)',
        'glow-green': '0 0 15px rgba(46, 213, 115, 0.4)',
        'inner-glow': 'inset 0 0 30px rgba(0, 212, 255, 0.05)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink': 'blink 1s ease-in-out infinite',
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        slideIn: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
