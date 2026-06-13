/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          100: '#3a3a3a',
          200: '#2d2d2d',
          300: '#242424',
          400: '#1e1e1e',
          500: '#181818',
          600: '#121212',
        },
        accent: {
          primary: '#4f46e5',
          secondary: '#06b6d4',
        }
      }
    },
  },
  plugins: [],
}
